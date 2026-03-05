const AGENT_FAB_CSS = `
@keyframes agent-fab-rotate {
  from { --agent-angle: 0deg; }
  to { --agent-angle: 360deg; }
}
@property --agent-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.agent-fab-border {
  position: relative;
  border-radius: 50%;
  padding: 3px;
  background: conic-gradient(from var(--agent-angle), var(--agent-primary, #db2129) 0%, #34d399 50%, var(--agent-primary, #db2129) 100%);
  animation: agent-fab-rotate 3s linear infinite;
}
.agent-fab-border-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: #fff;
}
.agent-fab-border-inner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}
@media (prefers-reduced-motion: reduce) {
  .agent-fab-border { animation: none; }
}`;

let injected = false;
export function injectAgentFabCSS() {
  if (injected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = AGENT_FAB_CSS;
  document.head.appendChild(style);
  injected = true;
}
