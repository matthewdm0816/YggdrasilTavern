import { describe, expect, it } from "vitest";
import { ttsDisplayText } from "./displayText";

describe("ttsDisplayText", () => {
  it("keeps speech and narration while removing only exact TTS wrappers", () => {
    expect(ttsDisplayText('She smiles. <tts>**Hello**</tts> <TTS>Again.</TTS>')).toBe('She smiles. **Hello** Again.');
  });

  it("preserves other HTML, attributes, comments and escaped examples", () => {
    const content = '<span title="<tts>">x</span> <!-- <tts>example</tts> --> \\<tts>example\\</tts> <tts voice="x">y</tts-extra>';
    expect(ttsDisplayText(content)).toBe(content);
  });

  it.each(["```xml", "~~~~xml"])("keeps wrappers in %s fenced code", (opening) => {
    const closing = opening.startsWith("`") ? "```" : "~~~~";
    const code = `${opening}\n<tts>example</tts>\n${closing}`;
    expect(ttsDisplayText(`${code}\n<tts>Speech.</tts>`)).toBe(`${code}\nSpeech.`);
  });

  it("preserves inline code including longer delimiters and embedded backticks", () => {
    const examples = '`<tts>example</tts>` and `` `<tts>example</tts>` ``';
    expect(ttsDisplayText(`${examples} <tts>Speech.</tts>`)).toBe(`${examples} Speech.`);
  });

  it("leaves unfinished code examples untouched", () => {
    expect(ttsDisplayText('```\n<tts>example')).toBe('```\n<tts>example');
    expect(ttsDisplayText('`<tts>example')).toBe('`<tts>example');
  });

  it("preserves CRLF fences and strips tags after them", () => {
    const code = '  ```xml\r\n<tts>example</tts>\r\n  ```';
    expect(ttsDisplayText(`${code}\r\n<TTS>Speech</TTS>`)).toBe(`${code}\r\nSpeech`);
  });

  it("shows content during streaming before the closing TTS tag arrives", () => {
    expect(ttsDisplayText('<tts>Streaming text')).toBe('Streaming text');
  });

  it("does not mutate ordinary markdown or MiniMax speech cues", () => {
    const content = '# Title\n\n- **Bold** (laughs) <#0.5#>\n- [Link](https://example.com)';
    expect(ttsDisplayText(content)).toBe(content);
  });
});
