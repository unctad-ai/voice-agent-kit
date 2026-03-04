export type VoiceState = 'IDLE' | 'LISTENING' | 'USER_SPEAKING' | 'PROCESSING' | 'AI_SPEAKING';
export type OrbState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export type ActionCategory = 'navigation' | 'form' | 'ui' | 'search' | 'info';

export interface VoiceMessage {
  role: 'user' | 'assistant' | 'action';
  text: string;
  timestamp: number;
  action?: { name: string; category: ActionCategory; result?: string };
}

export interface VoiceToolResult {
  name: string;
  result: unknown;
  displayText: string;
}

export function voiceStateToOrbState(state: VoiceState): OrbState {
  const map: Record<VoiceState, OrbState> = {
    IDLE: 'idle',
    LISTENING: 'listening',
    USER_SPEAKING: 'listening',
    PROCESSING: 'processing',
    AI_SPEAKING: 'speaking',
  };
  return map[state];
}
