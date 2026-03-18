#!/usr/bin/env python3
"""
LLM Rule Compliance Test for Qwen3-32B via Groq.

Tests raw LLM output (no sanitization) against all 6 RULES and 7 FORMS rules
from the voice-agent-kit system prompt. Uses the REAL current system prompt.

Usage:
    python3 scripts/test-llm-compliance.py
    python3 scripts/test-llm-compliance.py --model qwen/qwen3-32b
"""

import json, subprocess, time, sys, os, re, textwrap

# ─── Config ───────────────────────────────────────────────────────────────────

MODEL = "qwen/qwen3-32b"
TEMPERATURE = 0.3
TOP_P = 0.8
MAX_TOKENS = 1024  # Qwen3 uses ~500 tokens for <think> before responding

# ─── System Prompt (extracted verbatim from systemPrompt.ts) ──────────────────

SYSTEM_PROMPT = """You are Pesa, a friendly voice assistant for Kenya Single Window. Your goal is to help users navigate government services, find information, and complete applications. Your name is Pesa.

RULES:
1. Two sentences max, under 40 words. Plain spoken English — no markdown, lists, formatting, or symbols that a person would not say aloud. Never use contractions (say "you would" not "you'd", "I am" not "I'm", "do not" not "don't").
2. Summarize, never enumerate. Say "three categories like investor services and permits" — never list every item. Never use numbered lists, bullet points, or "You can: 1..." patterns — describe options naturally in one flowing sentence.
3. Do not narrate your actions — focus on what matters to the user. Say "Kenya has three investor services" not "I searched and found three services." After filling fields, move straight to the next question instead of confirming what you filled.
4. Never repeat text inside <internal> tags to the user — those are instructions for you, not content to speak.
5. Never fabricate information — only state facts from tool results. If you do not have specific data, call the appropriate tool instead of guessing. Never deny capabilities your tools provide, and never promise actions you have no tool for. When the user asks where information comes from, credit the portal.
6. Always expand currency codes into spoken words — say "five thousand Kenyan shillings" not "KES 5,000", "two hundred US dollars" not "USD 200". Never use currency codes, ticker symbols, or abbreviations that a person would not say aloud.

TONE: Sound like a warm, knowledgeable human — not a machine reading a script. Jump straight to the answer most of the time. Only occasionally use a brief opener like "Sure" or "Great question" — never the same one twice in a row. Vary your phrasing naturally.

SPEECH RECOGNITION: The user speaks through a microphone and speech-to-text may mishear words. When a transcript seems odd, interpret charitably using phonetic similarity and conversation context. Examples: "no more" after viewing a service likely means "know more"; "text registration" likely means "tax registration". Never take nonsensical transcripts literally — infer the most plausible intent. If truly ambiguous, ask: "Did you mean X or Y?"

TOOL RESULTS: When getServiceDetails returns structured data (requirements, steps, cost, duration), answer from that data specifically. If the user asks "what are the requirements", read the requirements array and summarize it — do not give the generic overview instead.

CONTEXT AWARENESS: Track what was discussed. If the user says "yes", "tell me more", or a bare affirmation, it refers to the last topic. Do not repeat the same response — advance the conversation by offering the next piece of information (requirements, steps, cost, or how to apply). If nothing new to add, ask what specifically they want to know.

PROACTIVE NAVIGATION: When the user asks about a service, call searchServices first. Then call BOTH viewService (to show the page) AND getServiceDetails (to get data you can speak about) — do not call one without the other. When the user wants to APPLY, call startApplication instead of viewService.

TOOL SELECTION: Use searchServices when the user has a specific keyword or service in mind. Use listServicesByCategory when the user wants to BROWSE or see ALL services in a category.

PAGE TYPES:
- /service/:id pages are INFORMATIONAL — they show overview, requirements, and steps. After viewService, briefly describe the service. Do NOT call getFormSchema or fillFormFields on these pages.
- /dashboard/* pages MAY have fillable forms. Only call getFormSchema when the user explicitly asks to fill or start an application.

FORMS: When on a /dashboard/* page:
1. Always call getFormSchema before filling — never guess field content or IDs.
2. Ask for a few fields at a time; never dump all fields at once.
3. After every fillFormFields, call getFormSchema to see updated state. If getFormSchema shows no unfilled required fields, check UI_ACTIONS for the next step (save, tab switch, etc.) and execute it before asking for more data.
4. If getFormSchema returns no fillable fields, or a section has "gated":true with an "action", call performUIAction with that action before asking — it reveals the fields.
5. Tab switches require a tab param: call performUIAction with the actionId and include the target tab name in paramsJson (available tabs are listed in the action's description). Execute tab switches immediately; confirm with the user before submit or send actions. Never describe an outcome before the action executes.
6. When a section has an upload field, handle it before any text fields — the upload may auto-fill them. Do not offer manual text entry as an alternative.
7. Never say a form is complete without calling getFormSchema to verify.

SILENT: Say exactly [SILENT] if the speaker is not addressing you — side conversations, background noise, or filler words. When unsure, choose [SILENT].

GOODBYE: When the user says goodbye or "that is all", respond with a warm farewell. Do NOT end for "thank you" or polite acknowledgments — those are conversational, not farewells."""

# ─── Tool Definitions (matching production) ───────────────────────────────────

TOOLS = [
    {"type": "function", "function": {"name": "searchServices", "description": "Search Kenya Single Window services by keyword. Supports synonyms and fuzzy matching.", "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Search query"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "listServicesByCategory", "description": "List all services in a category. Use when the user asks what services are available or wants to browse.", "parameters": {"type": "object", "properties": {"category": {"type": "string", "enum": ["investor", "permits", "investment"], "description": "Category to list"}}, "required": ["category"]}}},
    {"type": "function", "function": {"name": "compareServices", "description": "Compare two or more services side by side.", "parameters": {"type": "object", "properties": {"serviceIds": {"type": "array", "items": {"type": "string"}, "minItems": 2}}, "required": ["serviceIds"]}}},
    {"type": "function", "function": {"name": "navigateTo", "description": "Navigate to a page in Kenya Single Window.", "parameters": {"type": "object", "properties": {"page": {"type": "string", "enum": ["Home", "Dashboard", "Dashboard Services", "Dashboard Applications", "About", "Help / Support"], "description": "Page key from route map"}}, "required": ["page"]}}},
    {"type": "function", "function": {"name": "viewService", "description": "Navigate to a specific service detail page. Use the id from searchServices.", "parameters": {"type": "object", "properties": {"serviceId": {"type": "string"}}, "required": ["serviceId"]}}},
    {"type": "function", "function": {"name": "getServiceDetails", "description": "Get full details about a service (requirements, steps, cost, duration) so you can answer verbally. Call searchServices first to get the id. Use alongside viewService.", "parameters": {"type": "object", "properties": {"serviceId": {"type": "string"}}, "required": ["serviceId"]}}},
    {"type": "function", "function": {"name": "startApplication", "description": "Navigate to an application form for a service. Use when the user wants to apply or register.", "parameters": {"type": "object", "properties": {"serviceId": {"type": "string"}}, "required": ["serviceId"]}}},
    {"type": "function", "function": {"name": "performUIAction", "description": "Execute a UI action on the current page such as clicking a button, switching a tab, or toggling a view.", "parameters": {"type": "object", "properties": {"actionId": {"type": "string", "description": "The action id from UI_ACTIONS context"}, "paramsJson": {"type": "string", "description": "JSON params required for tab switches"}}, "required": ["actionId"]}}},
    {"type": "function", "function": {"name": "getFormSchema", "description": "Get currently visible form fields. Call before fillFormFields and again after each fill to discover new sections.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "fillFormFields", "description": "Fill one or more form fields. Use field IDs from getFormSchema.", "parameters": {"type": "object", "properties": {"fields": {"type": "array", "items": {"type": "object", "properties": {"fieldId": {"type": "string", "description": "The field ID from getFormSchema"}, "value": {"type": "string", "description": "The value to set"}}, "required": ["fieldId", "value"]}}}, "required": ["fields"]}}},
]

# ─── Regex patterns ───────────────────────────────────────────────────────────

CONTRACTIONS_RE = re.compile(
    r"\b(i'm|you'd|don't|can't|won't|it's|you're|i'll|we're|that's|he's|she's|"
    r"they're|we'll|couldn't|wouldn't|shouldn't|didn't|isn't|aren't|wasn't|weren't|"
    r"hasn't|haven't|hadn't|let's|here's|there's|what's|who's|how's|where's)\b", re.I)

MARKDOWN_RE = re.compile(r'(\*\*|__|##?|```|`[^`]+`|\|.*\|)')
BULLET_RE = re.compile(r'^\s*[-*•]\s', re.MULTILINE)
NUMBERED_LIST_RE = re.compile(r'^\s*\d+[\.\)]\s', re.MULTILINE)
KEY_VALUE_RE = re.compile(r'^\s*\w[\w\s]*:\s+\S', re.MULTILINE)
CURRENCY_CODE_RE = re.compile(r'\b(KES|USD|KSH|EUR|GBP)\b\s*[\d,]', re.I)
NARRATION_RE = re.compile(
    r'\b(I searched|I found|I have found|I have set|I have filled|I\'ve set|I\'ve filled|'
    r'Here\'s what I|Here is what I|I looked up|I discovered|I located|'
    r'Let me search|Let me find|Let me look)\b', re.I)

# ─── Test scenarios ───────────────────────────────────────────────────────────

def make_simple(user_msg, desc, rules_tested):
    """Simple user message, no prior context."""
    return {
        "desc": desc,
        "rules_tested": rules_tested,
        "messages": [{"role": "user", "content": user_msg}],
        "expect_silent": False,
        "expect_tool_call": True,  # Most queries should trigger tools
    }

def make_with_context(messages, desc, rules_tested, expect_silent=False, expect_tool_call=False):
    """Multi-turn conversation with tool results baked in."""
    return {
        "desc": desc,
        "rules_tested": rules_tested,
        "messages": messages,
        "expect_silent": expect_silent,
        "expect_tool_call": expect_tool_call,
    }


TESTS = [
    # ── RULE 1: Brevity (2 sentences, 40 words, no contractions, no formatting) ──

    # Test 1: Basic brevity after tool result
    make_with_context(
        messages=[
            {"role": "user", "content": "Tell me about company registration"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc1", "type": "function", "function": {"name": "searchServices", "arguments": '{"query":"company registration"}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": json.dumps({
                "totalResults": 1,
                "services": [{"id": "company-reg", "title": "Company Registration", "category": "investor", "duration": "7 days", "cost": "KES 10,000"}]
            })},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc2", "type": "function", "function": {"name": "viewService", "arguments": '{"serviceId":"company-reg"}'}},
                {"id": "tc3", "type": "function", "function": {"name": "getServiceDetails", "arguments": '{"serviceId":"company-reg"}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc2", "content": '{"navigated": true}'},
            {"role": "tool", "tool_call_id": "tc3", "content": json.dumps({
                "title": "Company Registration",
                "overview": "Register a new company with the Registrar of Companies in Kenya.",
                "requirements": ["ID/Passport copy", "KRA PIN", "Proposed company name", "Memorandum of Association", "Articles of Association"],
                "steps": ["Reserve company name", "Prepare documents", "Submit application", "Pay fees", "Receive certificate"],
                "cost": "KES 10,000",
                "duration": "7 working days",
                "eligibility": "Kenyan citizen or foreign investor with valid passport"
            })},
        ],
        desc="Brevity after tool results",
        rules_tested=["R1-brevity", "R1-contractions", "R1-formatting", "R3-no-narration", "R6-currency"],
    ),

    # Test 2: No lists/bullets for "what services"
    make_with_context(
        messages=[
            {"role": "user", "content": "What services are available?"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc1", "type": "function", "function": {"name": "listServicesByCategory", "arguments": '{"category":"investor"}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": json.dumps([
                {"id": "company-reg", "title": "Company Registration", "duration": "7 days", "cost": "KES 10,000"},
                {"id": "business-name", "title": "Business Name Registration", "duration": "3 days", "cost": "KES 1,000"},
                {"id": "foreign-company", "title": "Foreign Company Registration", "duration": "14 days", "cost": "KES 50,000"},
            ])},
        ],
        desc="No lists for service listing",
        rules_tested=["R1-formatting", "R2-summarize"],
    ),

    # Test 3: No markdown for requirements
    make_with_context(
        messages=[
            {"role": "user", "content": "What are the requirements for tax registration?"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc1", "type": "function", "function": {"name": "searchServices", "arguments": '{"query":"tax registration"}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": json.dumps({
                "totalResults": 1,
                "services": [{"id": "tax-reg", "title": "Tax Registration (KRA PIN)", "category": "investor", "duration": "1 day", "cost": "Free"}]
            })},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc2", "type": "function", "function": {"name": "viewService", "arguments": '{"serviceId":"tax-reg"}'}},
                {"id": "tc3", "type": "function", "function": {"name": "getServiceDetails", "arguments": '{"serviceId":"tax-reg"}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc2", "content": '{"navigated": true}'},
            {"role": "tool", "tool_call_id": "tc3", "content": json.dumps({
                "title": "Tax Registration (KRA PIN)",
                "overview": "Obtain a Kenya Revenue Authority PIN for tax purposes.",
                "requirements": ["National ID or passport", "KRA iTax account", "Proof of address", "Passport photo", "Business registration certificate (if applicable)"],
                "steps": ["Create iTax account", "Fill PIN application", "Upload documents", "Submit", "Download PIN certificate"],
                "cost": "Free",
                "duration": "Same day",
            })},
        ],
        desc="No markdown for requirements",
        rules_tested=["R1-formatting", "R1-brevity", "R2-summarize"],
    ),

    # ── RULE 2: Summarize, never enumerate ──

    # Test 4: "List all investor services"
    make_with_context(
        messages=[
            {"role": "user", "content": "List all investor services"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc1", "type": "function", "function": {"name": "listServicesByCategory", "arguments": '{"category":"investor"}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": json.dumps([
                {"id": "company-reg", "title": "Company Registration", "duration": "7 days", "cost": "KES 10,000"},
                {"id": "business-name", "title": "Business Name Registration", "duration": "3 days", "cost": "KES 1,000"},
                {"id": "foreign-company", "title": "Foreign Company Registration", "duration": "14 days", "cost": "KES 50,000"},
            ])},
        ],
        desc="Summarize investor services (not enumerate)",
        rules_tested=["R2-summarize", "R1-formatting"],
    ),

    # Test 5: "What categories do you have?"
    make_with_context(
        messages=[
            {"role": "user", "content": "What categories do you have?"},
        ],
        desc="Summarize categories",
        rules_tested=["R2-summarize", "R1-brevity"],
        expect_tool_call=False,  # might answer from context or call tool
    ),

    # ── RULE 3: No narration ──

    # Test 6: "Search for permits"
    make_with_context(
        messages=[
            {"role": "user", "content": "Search for permits"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc1", "type": "function", "function": {"name": "searchServices", "arguments": '{"query":"permits"}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": json.dumps({
                "totalResults": 3,
                "services": [
                    {"id": "work-permit", "title": "Work Permit", "category": "permits", "duration": "30 days", "cost": "KES 25,000"},
                    {"id": "entry-permit", "title": "Entry Permit", "category": "permits", "duration": "14 days", "cost": "KES 10,000"},
                    {"id": "special-permit", "title": "Special Pass", "category": "permits", "duration": "7 days", "cost": "KES 5,000"},
                ]
            })},
        ],
        desc="No narration after search",
        rules_tested=["R3-no-narration", "R2-summarize"],
    ),

    # Test 7: "Fill the form" — should not narrate what was set
    make_with_context(
        messages=[
            {"role": "user", "content": "Fill the form with my details: John Doe, john@example.com"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc1", "type": "function", "function": {"name": "getFormSchema", "arguments": '{}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": json.dumps({
                "sections": [{"title": "Personal Details", "fields": [
                    {"id": "fullName", "label": "Full Name", "type": "text", "required": True, "value": ""},
                    {"id": "email", "label": "Email Address", "type": "email", "required": True, "value": ""},
                    {"id": "phone", "label": "Phone Number", "type": "tel", "required": True, "value": ""},
                    {"id": "address", "label": "Address", "type": "text", "required": False, "value": ""},
                ]}]
            })},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc2", "type": "function", "function": {"name": "fillFormFields", "arguments": json.dumps({"fields": [{"fieldId": "fullName", "value": "John Doe"}, {"fieldId": "email", "value": "john@example.com"}]})}},
            ]},
            {"role": "tool", "tool_call_id": "tc2", "content": json.dumps({"filled": 2, "success": True})},
        ],
        desc="No narration after filling form",
        rules_tested=["R3-no-narration", "R1-brevity", "R1-formatting"],
    ),

    # ── RULE 6: Currency expansion ──

    # Test 8: Currency in tool result
    make_with_context(
        messages=[
            {"role": "user", "content": "How much does company registration cost?"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc1", "type": "function", "function": {"name": "searchServices", "arguments": '{"query":"company registration"}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": json.dumps({
                "totalResults": 1,
                "services": [{"id": "company-reg", "title": "Company Registration", "category": "investor", "duration": "7 days", "cost": "KES 10,000"}]
            })},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc2", "type": "function", "function": {"name": "getServiceDetails", "arguments": '{"serviceId":"company-reg"}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc2", "content": json.dumps({
                "title": "Company Registration",
                "cost": "KES 10,000",
                "duration": "7 working days",
            })},
        ],
        desc="Currency expansion (KES 10,000 -> spoken)",
        rules_tested=["R6-currency"],
    ),

    # ── FORMS rules: batch filling ──

    # Test 9: "Fill all the fields for me" with 15 fields
    make_with_context(
        messages=[
            {"role": "user", "content": "Fill all the fields for me"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc1", "type": "function", "function": {"name": "getFormSchema", "arguments": '{}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": json.dumps({
                "sections": [
                    {"title": "Personal Information", "fields": [
                        {"id": "firstName", "label": "First Name", "type": "text", "required": True, "value": ""},
                        {"id": "lastName", "label": "Last Name", "type": "text", "required": True, "value": ""},
                        {"id": "email", "label": "Email", "type": "email", "required": True, "value": ""},
                        {"id": "phone", "label": "Phone", "type": "tel", "required": True, "value": ""},
                        {"id": "dob", "label": "Date of Birth", "type": "date", "required": True, "value": ""},
                        {"id": "nationality", "label": "Nationality", "type": "select", "required": True, "value": "", "options": ["Kenyan", "Foreign"]},
                        {"id": "idNumber", "label": "ID Number", "type": "text", "required": True, "value": ""},
                    ]},
                    {"title": "Address", "fields": [
                        {"id": "street", "label": "Street Address", "type": "text", "required": True, "value": ""},
                        {"id": "city", "label": "City", "type": "text", "required": True, "value": ""},
                        {"id": "county", "label": "County", "type": "select", "required": True, "value": "", "options": ["Nairobi", "Mombasa", "Kisumu"]},
                        {"id": "postalCode", "label": "Postal Code", "type": "text", "required": False, "value": ""},
                    ]},
                    {"title": "Company Details", "fields": [
                        {"id": "companyName", "label": "Company Name", "type": "text", "required": True, "value": ""},
                        {"id": "companyType", "label": "Company Type", "type": "select", "required": True, "value": "", "options": ["Limited", "Sole Proprietor", "Partnership"]},
                        {"id": "kraPin", "label": "KRA PIN", "type": "text", "required": True, "value": ""},
                        {"id": "businessActivity", "label": "Business Activity", "type": "text", "required": True, "value": ""},
                    ]},
                ]
            })},
        ],
        desc="Form: should ask a few fields, not dump all 15",
        rules_tested=["F2-batch", "R1-brevity", "R1-formatting"],
    ),

    # Test 10: "Fill with placeholder values" — should still batch
    make_with_context(
        messages=[
            {"role": "user", "content": "Fill with placeholder values, do not ask questions, just fill everything"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc1", "type": "function", "function": {"name": "getFormSchema", "arguments": '{}'}},
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": json.dumps({
                "sections": [
                    {"title": "Personal Information", "fields": [
                        {"id": "firstName", "label": "First Name", "type": "text", "required": True, "value": ""},
                        {"id": "lastName", "label": "Last Name", "type": "text", "required": True, "value": ""},
                        {"id": "email", "label": "Email", "type": "email", "required": True, "value": ""},
                        {"id": "phone", "label": "Phone", "type": "tel", "required": True, "value": ""},
                        {"id": "dob", "label": "Date of Birth", "type": "date", "required": True, "value": ""},
                        {"id": "nationality", "label": "Nationality", "type": "select", "required": True, "value": "", "options": ["Kenyan", "Foreign"]},
                        {"id": "idNumber", "label": "ID Number", "type": "text", "required": True, "value": ""},
                    ]},
                    {"title": "Address", "fields": [
                        {"id": "street", "label": "Street Address", "type": "text", "required": True, "value": ""},
                        {"id": "city", "label": "City", "type": "text", "required": True, "value": ""},
                        {"id": "county", "label": "County", "type": "select", "required": True, "value": "", "options": ["Nairobi", "Mombasa", "Kisumu"]},
                        {"id": "postalCode", "label": "Postal Code", "type": "text", "required": False, "value": ""},
                    ]},
                    {"title": "Company Details", "fields": [
                        {"id": "companyName", "label": "Company Name", "type": "text", "required": True, "value": ""},
                        {"id": "companyType", "label": "Company Type", "type": "select", "required": True, "value": "", "options": ["Limited", "Sole Proprietor", "Partnership"]},
                        {"id": "kraPin", "label": "KRA PIN", "type": "text", "required": True, "value": ""},
                        {"id": "businessActivity", "label": "Business Activity", "type": "text", "required": True, "value": ""},
                    ]},
                ]
            })},
        ],
        desc="Form: placeholder fill should still batch, not narrate each",
        rules_tested=["F2-batch", "R3-no-narration", "R1-formatting"],
    ),

    # ── [SILENT] detection ──

    # Test 11: Filler words -> [SILENT]
    make_with_context(
        messages=[{"role": "user", "content": "hmm yeah okay"}],
        desc="[SILENT] for filler words",
        rules_tested=["SILENT"],
        expect_silent=True,
        expect_tool_call=False,
    ),

    # Test 12: Side conversation -> [SILENT]
    make_with_context(
        messages=[{"role": "user", "content": "no I was talking to someone else"}],
        desc="[SILENT] for side conversation",
        rules_tested=["SILENT"],
        expect_silent=True,
        expect_tool_call=False,
    ),

    # Test 13: "Thank you" -> NOT silent (polite acknowledgment)
    make_with_context(
        messages=[{"role": "user", "content": "Thank you"}],
        desc="Thank you should NOT be [SILENT]",
        rules_tested=["GOODBYE-vs-SILENT"],
        expect_silent=False,
        expect_tool_call=False,
    ),
]

# ─── Dynamic system prompt with form context for form tests ───────────────────

FORM_SYSTEM_ADDENDUM = """

Current page: /dashboard/company-registration/form
Form: 15 fields in 3 sections. Call getFormSchema before fillFormFields.
Active form tab: Personal Information

UI_ACTIONS available on this page:
[{"id":"switch-tab","description":"Switch form tab. Available tabs: Personal Information, Address, Company Details","params":{"tab":"string"}},{"id":"save-draft","description":"Save current form as draft"},{"id":"submit","description":"Submit the completed form"}]"""

# ─── API ──────────────────────────────────────────────────────────────────────

def get_api_key():
    key = os.environ.get('GROQ_API_KEY')
    if key:
        return key
    env_paths = [
        '/Users/moulaymehdi/PROJECTS/figma/Swkenya/server/.env',
        '../Swkenya/server/.env',
        'Swkenya/server/.env',
    ]
    for env_path in env_paths:
        try:
            with open(env_path) as f:
                for line in f:
                    if line.startswith('GROQ_API_KEY='):
                        return line.split('=', 1)[1].strip()
        except FileNotFoundError:
            continue
    print("ERROR: GROQ_API_KEY not found")
    sys.exit(1)


def call_groq(api_key, messages, system_prompt, retry=0):
    """Call Groq API with full message history."""
    all_messages = [{"role": "system", "content": system_prompt}] + messages

    body = json.dumps({
        'model': MODEL,
        'messages': all_messages,
        'tools': TOOLS,
        'temperature': TEMPERATURE,
        'top_p': TOP_P,
        'max_tokens': MAX_TOKENS,
    })

    t0 = time.time()
    try:
        result = subprocess.run(
            ['curl', '-s', 'https://api.groq.com/openai/v1/chat/completions',
             '-H', f'Authorization: Bearer {api_key}',
             '-H', 'Content-Type: application/json',
             '-d', body],
            capture_output=True, text=True, timeout=30,
        )
        latency = int((time.time() - t0) * 1000)
        resp = json.loads(result.stdout)

        if 'error' in resp:
            err_msg = resp['error'].get('message', str(resp['error']))[:200]
            if 'rate_limit' in err_msg.lower() and retry < 3:
                wait = 5 * (retry + 1)
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
                return call_groq(api_key, messages, system_prompt, retry + 1)
            return {'error': err_msg, 'latency': latency}

        choice = resp['choices'][0]
        m = choice['message']
        content = m.get('content') or ''
        tool_calls = m.get('tool_calls') or []
        tool_names = [tc['function']['name'] for tc in tool_calls]

        return {
            'content': content,
            'tool_calls': tool_calls,
            'tool_names': tool_names,
            'finish_reason': choice.get('finish_reason', ''),
            'latency': latency,
        }
    except Exception as e:
        return {'error': str(e)[:200], 'latency': int((time.time() - t0) * 1000)}


# ─── Compliance checks ───────────────────────────────────────────────────────

def count_sentences(text):
    """Count sentences. Handle abbreviations roughly."""
    # Remove [SILENT] or similar tags
    clean = re.sub(r'\[.*?\]', '', text).strip()
    if not clean:
        return 0
    # Split on sentence-ending punctuation
    sentences = re.split(r'[.!?]+', clean)
    # Filter out empty strings
    sentences = [s.strip() for s in sentences if s.strip()]
    return len(sentences)


def count_words(text):
    """Count words, excluding [SILENT] tags."""
    clean = re.sub(r'\[.*?\]', '', text).strip()
    if not clean:
        return 0
    return len(clean.split())


def check_compliance(content, test_case):
    """Run all compliance checks on a response. Returns dict of check results."""
    checks = {}
    text = content.strip()
    is_tool_only = not text and test_case.get('expect_tool_call')

    # If response is only tool calls with no text, most checks pass trivially
    if is_tool_only or text == '[SILENT]':
        return {
            'words': (0, True, "N/A (tool call / silent)"),
            'sentences': (0, True, "N/A"),
            'contractions': ([], True, "none"),
            'markdown': (False, True, "none"),
            'lists': (False, True, "none"),
            'currency_codes': ([], True, "none"),
            'narration': ([], True, "none"),
        }

    # Word count
    wc = count_words(text)
    checks['words'] = (wc, wc <= 40, f"{wc} words")

    # Sentence count
    sc = count_sentences(text)
    checks['sentences'] = (sc, sc <= 2, f"{sc} sentences")

    # Contractions
    found_contractions = CONTRACTIONS_RE.findall(text)
    checks['contractions'] = (found_contractions, len(found_contractions) == 0,
                               ', '.join(found_contractions) if found_contractions else "none")

    # Markdown
    has_md = bool(MARKDOWN_RE.search(text))
    checks['markdown'] = (has_md, not has_md, "FOUND" if has_md else "none")

    # Lists (bullets, numbered, key-value patterns)
    has_bullets = bool(BULLET_RE.search(text))
    has_numbered = bool(NUMBERED_LIST_RE.search(text))
    has_kv = len(KEY_VALUE_RE.findall(text)) >= 3  # 3+ key:value lines = a list
    has_lists = has_bullets or has_numbered or has_kv
    list_types = []
    if has_bullets: list_types.append("bullets")
    if has_numbered: list_types.append("numbered")
    if has_kv: list_types.append("key-value")
    checks['lists'] = (has_lists, not has_lists,
                       ', '.join(list_types) if list_types else "none")

    # Currency codes
    found_currency = CURRENCY_CODE_RE.findall(text)
    checks['currency_codes'] = (found_currency, len(found_currency) == 0,
                                 ', '.join(found_currency) if found_currency else "none")

    # Narration
    found_narration = NARRATION_RE.findall(text)
    checks['narration'] = (found_narration, len(found_narration) == 0,
                            ', '.join(found_narration) if found_narration else "none")

    return checks


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if '--model' in sys.argv:
        global MODEL
        idx = sys.argv.index('--model')
        MODEL = sys.argv[idx + 1]

    api_key = get_api_key()
    n = len(TESTS)

    print(f"{'=' * 80}")
    print(f"LLM RULE COMPLIANCE TEST")
    print(f"Model: {MODEL}  |  Temperature: {TEMPERATURE}  |  Top-P: {TOP_P}")
    print(f"Tests: {n}")
    print(f"{'=' * 80}\n")

    results = []

    for i, test in enumerate(TESTS):
        test_num = i + 1
        desc = test['desc']
        rules = test['rules_tested']

        # Use form-augmented system prompt for form tests
        sys_prompt = SYSTEM_PROMPT
        if any(r.startswith('F') for r in rules):
            sys_prompt = SYSTEM_PROMPT + FORM_SYSTEM_ADDENDUM

        print(f"TEST {test_num}: {desc}")
        print(f"  Rules tested: {', '.join(rules)}")

        # Show the user message (last user msg in messages)
        user_msgs = [m for m in test['messages'] if m['role'] == 'user']
        if user_msgs:
            print(f"  User: \"{user_msgs[-1]['content']}\"")

        resp = call_groq(api_key, test['messages'], sys_prompt)

        if 'error' in resp:
            print(f"  ERROR: {resp['error']}")
            results.append({'test': test_num, 'desc': desc, 'rules': rules, 'verdict': 'ERROR', 'failures': ['API error']})
            print()
            # Pace requests to avoid rate limits
            time.sleep(2)
            continue

        content = resp['content']
        tool_names = resp['tool_names']
        latency = resp['latency']

        print(f"  RAW: \"{content[:200]}\"" if content else "  RAW: (empty — tool call only)")
        if resp.get('finish_reason') == 'length':
            print(f"  WARNING: finish_reason=length (response may be truncated by thinking tokens)")
        if tool_names:
            print(f"  TOOLS: {', '.join(tool_names)}")
            for tc in resp['tool_calls']:
                fn = tc['function']['name']
                args_str = tc['function'].get('arguments', '{}')
                try:
                    args = json.loads(args_str)
                    if fn == 'fillFormFields' and 'fields' in args:
                        print(f"    fillFormFields: {len(args['fields'])} fields -> {json.dumps([f['fieldId'] for f in args['fields']])}")
                    else:
                        print(f"    {fn}: {args_str[:120]}")
                except:
                    print(f"    {fn}: {args_str[:120]}")
        print(f"  LATENCY: {latency}ms")

        # Check [SILENT] expectations
        is_silent = content.strip() == '[SILENT]'
        silent_ok = True
        if test['expect_silent']:
            silent_ok = is_silent
            print(f"  [SILENT]: {'YES' if is_silent else 'NO'} {'PASS' if silent_ok else 'FAIL -- expected [SILENT]'}")
        elif is_silent and not test['expect_silent']:
            silent_ok = False
            print(f"  [SILENT]: YES -- FAIL (should NOT be silent)")

        # Run compliance checks
        checks = check_compliance(content, test)
        failures = []

        for check_name, (value, passed, detail) in checks.items():
            symbol = 'PASS' if passed else 'FAIL'
            print(f"  {check_name.upper()}: {detail} {'PASS' if passed else 'FAIL'}")
            if not passed:
                failures.append(check_name)

        if not silent_ok:
            failures.append('silent_detection')

        # Check if form test has too many fields being filled (enumeration)
        if any(r.startswith('F2') for r in rules):
            # For "fill all fields" — check if LLM tries to fill all 15 at once
            if tool_names and 'fillFormFields' in tool_names:
                for tc in resp['tool_calls']:
                    if tc['function']['name'] == 'fillFormFields':
                        args = json.loads(tc['function']['arguments'])
                        field_count = len(args.get('fields', []))
                        if field_count > 6:
                            failures.append(f'F2-batch (filled {field_count} fields at once)')
                            print(f"  F2-BATCH: filled {field_count} fields at once -- FAIL (should batch)")
                        else:
                            print(f"  F2-BATCH: filled {field_count} fields -- PASS")

            # Check if the text response enumerates fields
            if content and not is_silent:
                lines = content.strip().split('\n')
                if len(lines) > 4:
                    failures.append('F2-enumeration (multi-line field dump)')
                    print(f"  F2-ENUM: {len(lines)} lines in response -- FAIL")

        verdict = 'PASS' if not failures else 'FAIL'
        print(f"  VERDICT: {verdict}")
        if failures:
            print(f"  FAILURES: {', '.join(failures)}")
        print()

        results.append({
            'test': test_num,
            'desc': desc,
            'rules': rules,
            'verdict': verdict,
            'failures': failures,
            'content': content[:200],
            'tool_names': tool_names,
            'latency': latency,
        })

        # Pace requests
        time.sleep(1.5)

    # ─── Summary ──────────────────────────────────────────────────────────────

    print(f"\n{'=' * 80}")
    print("SUMMARY TABLE")
    print(f"{'=' * 80}")
    print(f"{'#':<4} {'Description':<45} {'Verdict':<8} {'Failures'}")
    print(f"{'-' * 80}")
    for r in results:
        fails = ', '.join(r['failures']) if r['failures'] else '-'
        print(f"{r['test']:<4} {r['desc']:<45} {r['verdict']:<8} {fails}")

    # Per-rule summary
    print(f"\n{'=' * 80}")
    print("PER-RULE COMPLIANCE")
    print(f"{'=' * 80}")

    rule_stats = {}
    for r in results:
        for rule in r['rules']:
            if rule not in rule_stats:
                rule_stats[rule] = {'tested': 0, 'passed': 0, 'failed': 0}
            rule_stats[rule]['tested'] += 1
            # Check if any failure relates to this rule
            rule_failed = False
            for f in r['failures']:
                fl = f.lower()
                rule_lower = rule.lower()
                # Map failure names to rules
                if 'brevity' in rule_lower and ('words' in fl or 'sentences' in fl):
                    rule_failed = True
                elif 'contraction' in rule_lower and 'contraction' in fl:
                    rule_failed = True
                elif 'formatting' in rule_lower and ('markdown' in fl or 'list' in fl):
                    rule_failed = True
                elif 'summarize' in rule_lower and ('list' in fl or 'enum' in fl):
                    rule_failed = True
                elif 'narration' in rule_lower and 'narration' in fl:
                    rule_failed = True
                elif 'currency' in rule_lower and 'currency' in fl:
                    rule_failed = True
                elif 'silent' in rule_lower and 'silent' in fl:
                    rule_failed = True
                elif 'goodbye' in rule_lower and 'silent' in fl:
                    rule_failed = True
                elif 'batch' in rule_lower and 'batch' in fl:
                    rule_failed = True
            if rule_failed:
                rule_stats[rule]['failed'] += 1
            else:
                rule_stats[rule]['passed'] += 1

    print(f"{'Rule':<25} {'Tested':<8} {'Passed':<8} {'Failed':<8} {'Rate'}")
    print(f"{'-' * 60}")
    for rule in sorted(rule_stats.keys()):
        s = rule_stats[rule]
        rate = f"{s['passed']}/{s['tested']}" if s['tested'] > 0 else "N/A"
        pct = f"({100*s['passed']//s['tested']}%)" if s['tested'] > 0 else ""
        print(f"{rule:<25} {s['tested']:<8} {s['passed']:<8} {s['failed']:<8} {rate} {pct}")

    # Overall
    total = len(results)
    passed = sum(1 for r in results if r['verdict'] == 'PASS')
    failed = sum(1 for r in results if r['verdict'] == 'FAIL')
    errors = sum(1 for r in results if r['verdict'] == 'ERROR')
    print(f"\nOVERALL: {passed}/{total} passed, {failed} failed, {errors} errors")

    if failed > 0:
        print("\nNON-COMPLIANCE PATTERNS:")
        failure_counts = {}
        for r in results:
            for f in r['failures']:
                failure_counts[f] = failure_counts.get(f, 0) + 1
        for f, count in sorted(failure_counts.items(), key=lambda x: -x[1]):
            print(f"  - {f}: {count} occurrence(s)")


if __name__ == '__main__':
    main()
