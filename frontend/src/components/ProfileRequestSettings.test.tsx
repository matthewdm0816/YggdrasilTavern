import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProviderType } from "../lib/api";
import { customHeaderDrafts } from "../lib/profileRequestSettings";
import { ProfileRequestSettings } from "./ProfileRequestSettings";

function renderSettings(providerType: ProviderType, anthropicPromptCache = false) {
  return renderToStaticMarkup(<ProfileRequestSettings
    providerType={providerType}
    headers={customHeaderDrafts(["Authorization", "Content-Type"])}
    savedHeaderNames={["Authorization", "Content-Type"]}
    onHeadersChange={() => undefined}
    defaultParamsJson={'{"temperature": 0.7}'}
    onDefaultParamsJsonChange={() => undefined}
    jsonError={null}
    headersError={null}
    excludedBodyParams={["stream_options"]}
    onExcludedBodyParamsChange={() => undefined}
    anthropicPromptCache={anthropicPromptCache}
    onAnthropicPromptCacheChange={() => undefined}
    disabled={false}
  />);
}

describe("ProfileRequestSettings", () => {
  it("starts collapsed and renders saved header values as empty password fields", () => {
    const html = renderSettings("openai_responses");
    expect(html).toContain("高级请求设置");
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/type="password"[^>]*value=""/g)).toHaveLength(2);
    expect(html).toContain("已保存；留空保留原值");
    expect(html).toContain("更改协议、服务地址或请求路径");
    expect(html).toContain("会覆盖协议默认值");
    expect(html).toContain('value="stream_options"');
  });

  it("shows the opt-in cache control and current cost guidance only for Anthropic", () => {
    const html = renderSettings("anthropic_messages");
    expect(html).toContain("启用 Anthropic 提示词缓存");
    expect(html).not.toContain('checked=""');
    expect(html).toContain("1.25 倍");
    expect(html).toContain("0.1 倍");
    expect(html).toContain("5 分钟");
    expect(html).toContain("最低缓存长度随模型而异");
    expect(html).toContain("https://platform.claude.com/docs/en/build-with-claude/prompt-caching");
    expect(renderSettings("anthropic_messages", true)).toContain('checked=""');
    expect(renderSettings("openai_chat_completions")).not.toContain("启用 Anthropic 提示词缓存");
  });
});
