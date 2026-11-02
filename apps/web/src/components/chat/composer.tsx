import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_CHARS = 2000;

export function Composer({ onSend, onStop, isStreaming, disabled, placeholder }: { onSend: (text: string) => void; onStop: () => void; isStreaming: boolean; disabled?: boolean; placeholder?: string }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!value.trim() || isStreaming || disabled) return;
    onSend(value);
    setValue("");
    ref.current?.focus();
  };

  return (
    <div className="bg-card focus-within:ring-ring/40 flex items-end gap-2 rounded-2xl border p-2 shadow-sm transition-shadow focus-within:ring-2">
      <Textarea
        ref={ref}
        value={value}
        maxLength={MAX_CHARS}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={disabled ? "The assistant is not ready yet" : (placeholder ?? "Ask a question…")}
        aria-label="Your question"
        rows={1}
        className="max-h-40"
      />
      {isStreaming ? (
        <Button size="icon" variant="secondary" onClick={onStop} aria-label="Stop generating" className="rounded-xl">
          <Square className="size-4" />
        </Button>
      ) : (
        <Button size="icon" onClick={submit} disabled={!value.trim() || disabled} aria-label="Send" className="rounded-xl">
          <ArrowUp className="size-4" />
        </Button>
      )}
    </div>
  );
}
