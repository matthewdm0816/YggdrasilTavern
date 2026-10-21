const statusLabels: Record<string, string> = {
  complete: "已完成",
  streaming: "正在生成",
  cancelled: "已停止",
  failed: "生成失败",
  interrupted: "已中断"
};

export function messageStatusLabel(status: string): string {
  return statusLabels[status] || status || "未知状态";
}

// Lifecycle reasons written by the backend; provider errors are shown verbatim.
const lifecycleErrors: Record<string, string> = {
  "Generation cancelled by client disconnect": "生成已停止：连接已断开（点击了停止，或页面被关闭、刷新）。",
  "Generation stream closed before completion": "生成已中断：模型服务的流式响应在完成前关闭。",
  "Generation interrupted by process restart": "生成已中断：后端服务重启。",
  "Generation interrupted": "生成已中断。"
};

export function messageErrorText(error: string): string {
  return lifecycleErrors[error] || error;
}
