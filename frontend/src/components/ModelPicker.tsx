import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { api, APIProfile } from "../lib/api";
import "../styles/model-settings.css";

type Props = {
  profiles: APIProfile[];
  activeProfileId: string;
  onActiveProfileChange: (id: string) => void;
  onOpenSettings: () => void;
  disabled?: boolean;
  onError?: (message: string) => void;
  onChanged?: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onProfileUpdated?: (profile: APIProfile) => void;
};

// A Profile is an existing shared connection configuration. Persisting its model
// before choosing it ensures the next generation uses the model shown here.
export async function applyModelSelection(
  profile: APIProfile,
  model: string,
  onActiveProfileChange: (id: string) => void,
  onChanged?: () => Promise<void>,
  onSaved?: (profileId: string, model: string) => void,
  onProfileUpdated?: (profile: APIProfile) => void
) {
  if (model !== profile.model) {
    const saved = await api.updateProfile(profile.id, { model });
    onProfileUpdated?.(saved);
    onSaved?.(profile.id, saved.model);
    try {
      await onChanged?.();
    } catch (exc) {
      throw new Error(`模型已保存为 ${saved.model}，但连接配置读取失败；请重新打开设置确认。${exc instanceof Error ? exc.message : String(exc)}`);
    }
  }
  onActiveProfileChange(profile.id);
}

function choiceValue(profileId: string, model: string) {
  return JSON.stringify([profileId, model]);
}

export function ModelPicker({ profiles, activeProfileId, onActiveProfileChange, onOpenSettings, disabled, onError, onChanged, onBusyChange, onProfileUpdated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedModels, setSavedModels] = useState<Record<string, string>>({});
  const changingRef = useRef(false);
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const activeModel = activeProfile ? savedModels[activeProfile.id] || activeProfile.model : "";

  // A refreshed list is the authoritative server state, including settings edits.
  useEffect(() => { setSavedModels({}); }, [profiles]);

  async function selectModel(value: string) {
    if (!value || disabled || changingRef.current) return;
    changingRef.current = true;
    setBusy(true);
    setError(null);
    onBusyChange?.(true);
    try {
      const choice: unknown = JSON.parse(value);
      if (!Array.isArray(choice) || choice.length !== 2 || typeof choice[0] !== "string" || typeof choice[1] !== "string") {
        throw new Error("模型选择格式无效，请重新打开模型设置。");
      }
      const [profileId, model] = choice;
      const profile = profiles.find((item) => item.id === profileId);
      if (!profile) throw new Error("所选连接配置已不可用，请重新选择。");
      if (model !== profile.model && model !== savedModels[profile.id] && !profile.model_catalog.some((item) => item.id === model)) {
        throw new Error("所选模型不在当前连接配置的模型列表中，请刷新模型列表。");
      }
      await applyModelSelection(profile, model, onActiveProfileChange, onChanged, (id, savedModel) => {
        setSavedModels((current) => ({ ...current, [id]: savedModel }));
      }, onProfileUpdated);
    } catch (exc) {
      const message = `模型切换失败：${exc instanceof Error ? exc.message : String(exc)}`;
      setError(message);
      onError?.(message);
    } finally {
      changingRef.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="composer-model-picker">
      <div className="composer-model-controls">
        <label className="composer-model-choice">
          <span>{busy ? "正在切换模型…" : "当前模型"}</span>
          <select
            aria-label="当前模型"
            title={activeProfile ? `${activeProfile.name} · ${activeModel}` : "请选择模型"}
            value={activeProfile ? choiceValue(activeProfile.id, activeModel) : ""}
            disabled={disabled || busy || !profiles.length}
            onChange={(event) => void selectModel(event.target.value)}
          >
            {!activeProfile && <option value="">{profiles.length ? "请选择模型" : "尚未配置模型"}</option>}
            {profiles.map((profile) => {
              const currentModel = savedModels[profile.id] || profile.model;
              const modelIds = [...new Set([currentModel, ...profile.model_catalog.map((model) => model.id)])];
              return (
                <optgroup key={profile.id} label={profile.name}>
                  {modelIds.map((model) => <option key={model} value={choiceValue(profile.id, model)}>{model} · {profile.name}</option>)}
                </optgroup>
              );
            })}
          </select>
        </label>
        <button className="icon-button composer-model-settings" type="button" title="模型与连接设置" aria-label="打开模型与连接设置" disabled={busy} onClick={onOpenSettings}><Settings size={16} /></button>
      </div>
      {error && <p className="field-error composer-model-error" role="alert">{error}</p>}
    </div>
  );
}
