import { TextareaHTMLAttributes, useLayoutEffect, useRef } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function AutoSizeTextarea({ value, onChange, className = "", ...props }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const borderHeight = textarea.offsetHeight - textarea.clientHeight;
    textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
  }, [value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      className={`auto-size-textarea ${className}`.trim()}
      value={value}
      onChange={onChange}
    />
  );
}
