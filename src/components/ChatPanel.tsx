import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isStaticToolUIPart } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SalesforceAgentUIMessage } from '../../lib/ai/agents/salesforce-agent';

const transport = new DefaultChatTransport<SalesforceAgentUIMessage>({
  api: '/api/chat',
});

const SUGGESTED_PROMPTS = [
  'Which CMS channels exist in source but are missing in target?',
  'List all channels in the source org.',
  'Compare content for channel "hackathon" between source and target.',
  'What content is in source that is missing in target?',
];

export function ChatPanel() {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error, stop } = useChat<SalesforceAgentUIMessage>({
    transport,
  });

  const busy = status === 'submitted' || status === 'streaming';

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput('');
  };

  const handleSuggestion = (text: string) => {
    if (busy) return;
    sendMessage({ text });
  };

  return (
    <div className="chat">
      <div className="chat__scroll" ref={scrollRef}>
        <div className="chat__stream">
          {messages.length === 0 ? (
            <Welcome onPick={handleSuggestion} />
          ) : (
            messages.map((m) => <MessageView key={m.id} message={m} />)
          )}
          {busy && <ThinkingBubble />}
          {error && <div className="chat__error">{error.message}</div>}
        </div>
      </div>
      <div className="chat__composer">
        <form className="chat__form" onSubmit={handleSubmit}>
          <AutoTextarea
            value={input}
            onChange={setInput}
            onSubmit={() => handleSubmit()}
            disabled={busy}
          />
          {busy ? (
            <button type="button" className="chat__send" onClick={() => stop()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="chat__send" disabled={!input.trim()}>
              Send
            </button>
          )}
        </form>
        <div className="chat__footnote">
          Enter to send · Shift+Enter for a new line
        </div>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="welcome">
      <div className="welcome__logo">●</div>
      <h1 className="welcome__title">How can I help you migrate?</h1>
      <p className="welcome__subtitle">
        I can inspect CMS channels and published content in both connected orgs, and tell you
        what is missing in the target.
      </p>
      <div className="welcome__prompts">
        {SUGGESTED_PROMPTS.map((p) => (
          <button key={p} type="button" className="welcome__prompt" onClick={() => onPick(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageView({ message }: { message: SalesforceAgentUIMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`msg ${isUser ? 'msg--user' : 'msg--assistant'}`}>
      <div className="msg__avatar" aria-hidden>
        {isUser ? 'You' : 'AI'}
      </div>
      <div className="msg__body">
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <div key={i} className="msg__text">
                {isUser ? (
                  <p>{part.text}</p>
                ) : (
                  <Markdown text={part.text} />
                )}
              </div>
            );
          }
          if (isStaticToolUIPart(part)) {
            return <ToolPartView key={part.toolCallId ?? i} part={part} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" />
          ),
          table: ({ node: _node, ...props }) => (
            <div className="md__tablewrap">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

type AnyToolPart = Extract<SalesforceAgentUIMessage['parts'][number], { type: `tool-${string}` }>;

function ToolPartView({ part }: { part: AnyToolPart }) {
  const toolName = part.type.replace(/^tool-/, '');
  const running = part.state === 'input-streaming' || part.state === 'input-available';
  return (
    <div className={`toolcall ${running ? 'toolcall--running' : ''}`}>
      <div className="toolcall__head">
        <span className="toolcall__name">{toolName}</span>
        <span className="toolcall__state">{part.state}</span>
      </div>
      {(part.state === 'input-available' || part.state === 'output-available') && part.input != null && (
        <details className="toolcall__block">
          <summary>Input</summary>
          <pre>{JSON.stringify(part.input, null, 2)}</pre>
        </details>
      )}
      {part.state === 'output-available' && (
        <details className="toolcall__block">
          <summary>Output</summary>
          <pre>{JSON.stringify(part.output, null, 2)}</pre>
        </details>
      )}
      {part.state === 'output-error' && (
        <div className="toolcall__err">{String(part.errorText)}</div>
      )}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="msg msg--assistant">
      <div className="msg__avatar" aria-hidden>AI</div>
      <div className="msg__body">
        <div className="thinking">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function AutoTextarea({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <textarea
      ref={ref}
      className="chat__textarea"
      placeholder="Ask about CMS channels, compare content, or plan a migration…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKey}
      disabled={disabled}
      rows={1}
      autoFocus
    />
  );
}
