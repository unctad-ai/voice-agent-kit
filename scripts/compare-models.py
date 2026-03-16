#!/usr/bin/env python3
"""
Head-to-head Groq model comparison for the voice pipeline.

Tests tool calling accuracy, instruction following (brevity, contractions,
[SILENT] detection), and latency across candidate models.

Usage:
    # Compare default candidates
    python3 scripts/compare-models.py

    # Compare specific models
    python3 scripts/compare-models.py qwen/qwen3-32b openai/gpt-oss-120b llama-3.3-70b-versatile

Requires GROQ_API_KEY in Swkenya/server/.env or as an environment variable.
"""

import json, subprocess, time, sys, os, re

# ─── Config ───────────────────────────────────────────────────────────────────

DEFAULT_MODELS = ['qwen/qwen3-32b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile']

SYSTEM = """You are Pesa, a friendly voice assistant for Kenya Single Window. RULES:
1. Two sentences max, under 40 words. Plain spoken English — no markdown, lists, formatting, or bracketed tags like [Awaiting response]. Never use contractions (say "you would" not "you'd", "I am" not "I'm", "do not" not "don't").
2. Summarize, never enumerate. Say "three categories like investor services and permits" — never list every item.
3. After tool calls, do not narrate the tools — focus on the result. Say "Kenya has three investor services" not "I searched and found three services."
4. Never fabricate information. Never say you lack a capability your tools provide.
5. Say exactly [SILENT] if the speaker is not addressing you — side conversations, background noise, or filler words. When unsure, choose [SILENT].

PROACTIVE NAVIGATION: When the user asks about a service, call searchServices first. Then call BOTH viewService (to show the page) AND getServiceDetails (to get data you can speak about)."""

TOOLS = [
    {"type": "function", "function": {"name": "searchServices", "description": "Search Kenya Single Window services by keyword.", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "navigateTo", "description": "Navigate to a page.", "parameters": {"type": "object", "properties": {"page": {"type": "string", "enum": ["Home", "Dashboard", "Dashboard Services", "Dashboard Applications", "About", "Help / Support"]}}, "required": ["page"]}}},
    {"type": "function", "function": {"name": "viewService", "description": "Navigate to a service detail page.", "parameters": {"type": "object", "properties": {"serviceId": {"type": "string"}}, "required": ["serviceId"]}}},
    {"type": "function", "function": {"name": "getServiceDetails", "description": "Get full details about a service.", "parameters": {"type": "object", "properties": {"serviceId": {"type": "string"}}, "required": ["serviceId"]}}},
    {"type": "function", "function": {"name": "listServicesByCategory", "description": "List all services in a category.", "parameters": {"type": "object", "properties": {"category": {"type": "string", "enum": ["investor", "permits", "investment"]}}, "required": ["category"]}}},
]

# (query, expect_tools, expect_silent, description)
TESTS = [
    ("Take me to the home page", True, False, "navigation"),
    ("What services are available for tax registration?", True, False, "search"),
    ("I want to register a company", True, False, "search + intent"),
    ("Show me investor services", True, False, "category browse"),
    ("Take me to the dashboard", True, False, "navigation"),
    ("How much does company registration cost?", True, False, "detail query"),
    ("What permits do I need?", True, False, "category search"),
    ("Go to the about page", True, False, "navigation"),
    ("What is the processing time for investor registration?", True, False, "specific detail"),
    ("Tell me about company registration", True, False, "consistency-1"),
    ("Tell me about company registration", True, False, "consistency-2"),
    ("Tell me about company registration", True, False, "consistency-3"),
    ("Thank you", False, False, "polite — should NOT be silent"),
    ("hmm yeah okay", False, True, "filler — should be [SILENT]"),
    ("no no I was talking to someone else", False, True, "side convo — [SILENT]"),
]

CONTRACTIONS = re.compile(r"\b(i'm|you'd|don't|can't|won't|it's|you're|i'll|we're|that's|he's|she's|they're|we'll|couldn't|wouldn't|shouldn't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't)\b", re.I)

# ─── API ──────────────────────────────────────────────────────────────────────

def get_api_key():
    key = os.environ.get('GROQ_API_KEY')
    if key:
        return key
    # Try reading from Swkenya .env
    for env_path in ['../Swkenya/server/.env', 'Swkenya/server/.env']:
        try:
            with open(env_path) as f:
                for line in f:
                    if line.startswith('GROQ_API_KEY='):
                        return line.split('=', 1)[1].strip()
        except FileNotFoundError:
            continue
    print("ERROR: GROQ_API_KEY not found. Set it as env var or in Swkenya/server/.env")
    sys.exit(1)


def call_groq(api_key, model, msg):
    body = json.dumps({
        'model': model,
        'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': msg}],
        'tools': TOOLS,
        'temperature': 0,
        'max_tokens': 200,
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
            return {'error': resp['error']['message'][:200], 'latency': latency}
        choice = resp['choices'][0]
        m = choice['message']
        content = m.get('content') or ''
        tools = m.get('tool_calls') or []
        tool_names = ', '.join(tc['function']['name'] for tc in tools)
        words = len(content.split()) if content.strip() else 0
        has_contraction = bool(CONTRACTIONS.search(content))
        return {
            'content': content[:250], 'tools': len(tools), 'tool_names': tool_names,
            'finish': choice['finish_reason'], 'latency': latency, 'words': words,
            'has_contraction': has_contraction,
        }
    except Exception as e:
        return {'error': str(e)[:200], 'latency': int((time.time() - t0) * 1000)}


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    models = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_MODELS
    api_key = get_api_key()
    n = len(TESTS)

    scores = {}
    for model in models:
        s = {'tool_correct': 0, 'brevity': 0, 'silent_correct': 0, 'no_contraction': 0,
             'errors': 0, 'total_latency': 0, 'total': n}
        scores[model] = s

        print(f'\n{"=" * 70}')
        print(f'MODEL: {model}')
        print('=' * 70)

        for query, expect_tools, expect_silent, desc in TESTS:
            r = call_groq(api_key, model, query)
            tag = f'[{desc}]'

            if 'error' in r:
                print(f'  ERROR {tag} {r["error"][:100]} ({r["latency"]}ms)')
                s['errors'] += 1
                continue

            s['total_latency'] += r['latency']

            # Tool correctness
            has_tools = r['tools'] > 0
            tool_ok = (expect_tools and has_tools) or (not expect_tools and not has_tools)
            if tool_ok:
                s['tool_correct'] += 1

            # Brevity (under 40 words, or tool_calls finish)
            if r['words'] <= 40 or r['finish'] == 'tool_calls':
                s['brevity'] += 1

            # Silent detection
            is_silent = '[SILENT]' in (r['content'] or '')
            if expect_silent and is_silent:
                s['silent_correct'] += 1
            elif not expect_silent and not is_silent:
                s['silent_correct'] += 1

            # No contractions
            if not r.get('has_contraction', False):
                s['no_contraction'] += 1

            mark = '✓' if tool_ok else '✗'
            flags = []
            if expect_silent and is_silent:
                flags.append('SILENT✓')
            elif expect_silent and not is_silent:
                flags.append('SILENT✗')
            if r.get('has_contraction'):
                flags.append('CONTRACTION!')
            flag_str = ' '.join(flags)

            print(f'  {mark} {tag:<35} Tools:{r["tools"]} [{r["tool_names"]:<30}] W:{r["words"]:<3} {r["latency"]:>5}ms  {flag_str}')
            if r['content'] and not has_tools:
                print(f'    "{r["content"][:150]}"')

    # ─── Scorecard ────────────────────────────────────────────────────────────

    print(f'\n\n{"=" * 70}')
    print('SCORECARD')
    print('=' * 70)
    print(f'{"Model":<30} {"Tools":>7} {"Brief":>6} {"Silent":>7} {"NoCon":>6} {"Errs":>5} {"AvgMs":>7}')
    print('-' * 70)

    best_score = -1
    winner = None
    for model in models:
        s = scores[model]
        valid = s['total'] - s['errors']
        avg = s['total_latency'] // max(valid, 1)
        # Composite: tools (40%) + brevity (15%) + silent (15%) + no_contraction (10%) + speed (20%)
        speed_score = max(0, n - (avg // 500))  # penalty per 500ms
        composite = (s['tool_correct'] * 4 + s['brevity'] * 1.5 + s['silent_correct'] * 1.5 +
                     s['no_contraction'] * 1 + speed_score * 2 - s['errors'] * 5)
        if composite > best_score:
            best_score = composite
            winner = model
        print(f'{model:<30} {s["tool_correct"]}/{n}  {s["brevity"]}/{n}  {s["silent_correct"]}/{n}  {s["no_contraction"]}/{n}  {s["errors"]}/{n}  {avg:>5}ms')

    print(f'\n🏆 Winner: {winner}')


if __name__ == '__main__':
    main()
