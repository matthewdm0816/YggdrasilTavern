/** Remove TTS wrappers only for display; preserve stored text and code examples. */
export function ttsDisplayText(content: string): string {
  const output: string[] = [];
  let position = 0;
  while (position < content.length) {
    if (position === 0 || content[position - 1] === "\n") {
      const lineEnd = content.indexOf("\n", position);
      const end = lineEnd < 0 ? content.length : lineEnd + 1;
      const line = content.slice(position, end);
      const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(line);
      if (fence) {
        const delimiter = fence[1];
        const closing = new RegExp(`^ {0,3}${delimiter[0]}{${delimiter.length},}[ \\t]*\\r?$`, "m");
        const remainder = content.slice(end);
        const match = closing.exec(remainder);
        const blockEnd = match ? end + match.index + match[0].length : content.length;
        output.push(content.slice(position, blockEnd));
        position = blockEnd;
        continue;
      }
    }
    // Escaped markup is a literal example, not a wrapper to remove.
    if (content[position] === "\\" && position + 1 < content.length) {
      output.push(content.slice(position, position + 2));
      position += 2;
      continue;
    }
    if (content[position] === "`") {
      let runEnd = position + 1;
      while (content[runEnd] === "`") runEnd += 1;
      const delimiter = content.slice(position, runEnd);
      let close = content.indexOf(delimiter, runEnd);
      while (close >= 0 && (content[close - 1] === "`" || content[close + delimiter.length] === "`")) {
        close = content.indexOf(delimiter, close + delimiter.length);
      }
      const end = close < 0 ? content.length : close + delimiter.length;
      output.push(content.slice(position, end));
      position = end;
      continue;
    }
    if (content.startsWith("<!--", position)) {
      const close = content.indexOf("-->", position + 4);
      const end = close < 0 ? content.length : close + 3;
      output.push(content.slice(position, end));
      position = end;
      continue;
    }
    if (content[position] === "<" && /^<\/?[a-z]/i.test(content.slice(position, position + 3))) {
      // Read a whole HTML tag so <tts> inside another tag's attribute is untouched.
      let end = position + 1;
      let quote = "";
      for (; end < content.length; end += 1) {
        const char = content[end];
        if (quote) {
          if (char === quote) quote = "";
        } else if (char === '"' || char === "'") {
          quote = char;
        } else if (char === ">") {
          break;
        }
      }
      if (end < content.length) end += 1;
      const tag = content.slice(position, end);
      if (!/^<\/?tts>$/i.test(tag)) output.push(tag);
      position = end;
      continue;
    }
    output.push(content[position]);
    position += 1;
  }
  return output.join("");
}
