import { ChangeEvent, useState } from "react";
import { BookOpen, Link, Plus, Upload, UserRound } from "lucide-react";
import { api, APIProfile, CharacterSummary, WorldBook } from "../lib/api";
import { CollapsibleSection } from "./CollapsibleSection";
import { CharacterManager, WorldbookManager } from "./ResourceEditors";
import { SillyTavernImportPanel } from "./SillyTavernImportPanel";
import { useAccount } from "./AccountContext";

type Props = {
  profiles: APIProfile[];
  characters: CharacterSummary[];
  worldbooks: WorldBook[];
  onChanged: () => Promise<void>;
  onError?: (message: string) => void;
};

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function SidebarResources({ profiles, characters, worldbooks, onChanged, onError }: Props) {
  const account = useAccount();
  const [chubPath, setChubPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCharacterId, setNewCharacterId] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  async function importFile(event: ChangeEvent<HTMLInputElement>, kind: "character" | "worldbook") {
    const file = event.target.files?.[0];
    if (!file) return;
    onError?.("");
    setImportWarnings([]);
    setBusy(true);
    try {
      const imported = kind === "character" ? await api.importCharacter(file) : await api.importWorldbook(file);
      setImportWarnings(imported.import_warnings ?? []);
      await onChanged();
    } catch (cause) {
      const label = kind === "character" ? "角色卡" : "世界书";
      onError?.("导入" + label + "「" + file.name + "」失败：" + errorDetail(cause));
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function createBlankCharacter() {
    setBusy(true);
    try {
      const created = await api.createCharacter({
        name: "Assistant",
        first_mes: "*对方看向你，等待你的第一句话。*",
        description: "一个可自定义的 roleplay 角色。"
      });
      await onChanged();
      // Open the new character right away so it gets a real name instead of staying "Assistant".
      setNewCharacterId(created.id);
    } catch (cause) {
      onError?.(errorDetail(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createBlankWorldbook() {
    setBusy(true);
    try {
      await api.createWorldbook({ name: "新世界书", description: "关键词触发的世界设定。", entries: [] });
      await onChanged();
    } catch (cause) {
      onError?.(errorDetail(cause));
    } finally {
      setBusy(false);
    }
  }

  async function importFromChub(kind: "character" | "worldbook") {
    if (!chubPath.trim()) return;
    setBusy(true);
    setImportWarnings([]);
    try {
      const imported = kind === "character" ? await api.importChubCharacter(chubPath.trim()) : await api.importChubWorldbook(chubPath.trim());
      setImportWarnings(imported.import_warnings ?? []);
      setChubPath("");
      await onChanged();
    } catch (cause) {
      onError?.(errorDetail(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {importWarnings.length > 0 && <div className="import-warning" role="status"><strong>已导入，请检查以下设置：</strong><ul>{importWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
      <CollapsibleSection
        contentId="sidebar-characters-content"
        title={`角色卡 (${characters.length})`}
        icon={<UserRound size={16} />}
        storageKey="yggdrasil-tavern.sidebar.characters.expanded"
        defaultExpanded
      >
        <div>
          <div className="inline-actions resource-toolbar-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void createBlankCharacter()}>
              <Plus size={15} />
              空角色
            </button>
            <label className="file-button">
              <Upload size={15} />
              导入 JSON/PNG
              <input type="file" disabled={busy} accept=".json,.png,application/json,image/png" onChange={(event) => void importFile(event, "character")} />
            </label>
          </div>
          <CharacterManager characters={characters} onChanged={onChanged} onError={onError} openRequestId={newCharacterId} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        contentId="sidebar-worldbooks-content"
        title={`世界书 (${worldbooks.length})`}
        icon={<BookOpen size={16} />}
        storageKey="yggdrasil-tavern.sidebar.worldbooks.expanded"
        defaultExpanded
      >
        <div>
          <div className="inline-actions resource-toolbar-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void createBlankWorldbook()}>
              <Plus size={15} />
              空世界书
            </button>
            <label className="file-button">
              <Upload size={15} />
              导入 JSON
              <input type="file" disabled={busy} accept=".json,application/json" onChange={(event) => void importFile(event, "worldbook")} />
            </label>
          </div>
          <WorldbookManager worldbooks={worldbooks} onChanged={onChanged} onError={onError} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        contentId="sidebar-chub-import-content"
        title="Chub.ai 导入"
        icon={<Link size={16} />}
        storageKey="yggdrasil-tavern.sidebar.chub-import.expanded"
      >
        <div className="chub-import">
          <label className="form-field"><span>Chub 路径</span><input
              value={chubPath}
              placeholder="characters/user/slug 或 lorebooks/user/slug"
              onChange={(event) => setChubPath(event.target.value)}
            /><small>填写 characters/user/slug 或 lorebooks/user/slug。</small></label>
          <div className="inline-actions">
            <button className="secondary-button" type="button" disabled={busy || !chubPath.trim()} onClick={() => void importFromChub("character")}>
              导入角色
            </button>
            <button className="secondary-button" type="button" disabled={busy || !chubPath.trim()} onClick={() => void importFromChub("worldbook")}>
              导入世界书
            </button>
          </div>
        </div>
      </CollapsibleSection>
      {(!account?.status.enabled || account.status.user?.is_admin) && <SillyTavernImportPanel profiles={profiles} onChanged={onChanged} onError={onError} />}
    </>
  );
}
