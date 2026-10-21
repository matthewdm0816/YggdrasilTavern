"""Data model for every planning artifact and the post-draft state ledger.

Field descriptions are written in Chinese on purpose: the JSON schema generated
from these models is shown to the planning model, so the descriptions double as
instructions. They are never shown to the prose writer.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- bible (设定集)


class Voice(Model):
    first_person: str = Field(description="正文中实际使用的中文自称，只写一个，例如：我 / 本小姐 / 在下 / 人家 / 老子")
    speech_style: str = Field(description="说话方式：用词、敬语程度、语速、句尾习惯")
    verbal_tics: list[str] = Field(default_factory=list, description="口癖，没有就留空")
    sample_lines: list[str] = Field(description="2~3 句最能体现性格的台词")


class Character(Model):
    id: str = Field(description="小写英文 id，例如 hero / heroine / senpai")
    name: str
    role: Literal["protagonist", "heroine", "rival", "mentor", "support", "antagonist", "other"]
    profile: str = Field(description="年龄、身份、外貌要点")
    personality: str
    want: str = Field(description="表面上想要的东西")
    need: str = Field(description="真正需要、但自己没意识到的东西")
    flaw: str = Field(description="会制造冲突的缺点")
    secret: str = Field(default="", description="不为人知的秘密；揭晓之前不会告诉写手")
    arc: str = Field(description="整部作品中的成长或变化")
    voice: Voice


class AddressTerm(Model):
    speaker: str = Field(description="说话人 id")
    listener: str = Field(description="被称呼者 id")
    term: str = Field(description="当前的称呼本身，例如：前辈 / XX同学 / 笨蛋 / 直呼名字；不要写将来的变化")


class Ability(Model):
    id: str = Field(description="小写英文 id")
    owner: str = Field(description="持有者角色 id")
    name: str
    effect: str = Field(description="能做到什么")
    limits: str = Field(description="做不到什么、触发条件、上限")
    cost: str = Field(description="使用的代价；必须是真实的损失")
    concealed_until: str | None = Field(
        default=None, description="如果读者一开始不知道这个能力存在，填写揭开它的谜团 id；揭开之前写手只能侧面暗示")
    cost_concealed_until: str | None = Field(
        default=None, description="如果代价本身是个谜，填写揭开代价的谜团 id")


class PowerSystem(Model):
    overview: str
    rules: list[str] = Field(description="力量的硬规则，故事里不能违反；只供规划使用，可以包含秘密")
    abilities: list[Ability]


class Mystery(Model):
    id: str = Field(description="M1、M2 …")
    question: str = Field(description="读者会好奇的问题")
    answer: str = Field(description="真相；揭晓之前不会告诉写手")


class Motif(Model):
    id: str = Field(description="小写英文 id")
    image: str = Field(description="反复出现的意象、物件、动作或 running gag")
    meaning: str = Field(description="它承载的意义")
    evolution: str = Field(description="它的意义如何随故事变化")


class Location(Model):
    name: str
    description: str


class World(Model):
    overview: str = Field(description="角色和读者一开始就知道的世界概况；秘密不要写在这里")
    rules: list[str] = Field(default_factory=list, description="角色们都知道的常识与社会规则；秘密不要写在这里")
    locations: list[Location] = Field(default_factory=list)


class Bible(Model):
    title: str
    logline: str = Field(description="一句话卖点")
    genre_tags: list[str]
    tone: str
    theme: str = Field(description="以问题形式写出的主题，例如『……真的是……吗？』")
    series_arc: str = Field(description="整个系列的大致走向")
    world: World
    power_system: PowerSystem
    characters: list[Character]
    address_book: list[AddressTerm] = Field(description="主要角色之间的初始称呼")
    mysteries: list[Mystery]
    motifs: list[Motif]


# ---------------------------------------------------------- volume outline (卷纲)


class Foreshadow(Model):
    id: str = Field(description="F1、F2 …")
    surface: str = Field(description="读者在正文中看到的表面细节，也就是伏笔本身")
    truth: str = Field(description="它真正指向的事实")
    plant: int = Field(description="埋下的章节号")
    reinforce: list[int] = Field(default_factory=list, description="二次提醒的章节号")
    payoff: int | None = Field(default=None, description="回收的章节号；留给后续卷回收则为 null")
    payoff_note: str = Field(description="如何回收")
    subtlety: Literal["hidden", "noticeable", "obvious"] = Field(
        description="hidden=读者几乎不会注意；noticeable=细心读者会注意；obvious=明确的悬念"
    )


class Twist(Model):
    chapter: int
    what: str = Field(description="转折的内容")
    why_inevitable: str = Field(description="回头看为什么是必然的")
    clues: list[str] = Field(description="支撑这个转折的伏笔 id（至少两个）")


class Thread(Model):
    id: str = Field(description="T1、T2 …")
    name: str
    kind: Literal["main", "romance", "character", "mystery", "comedy", "sub"]
    description: str
    touches: list[int] = Field(description="推进这条线的章节号")
    resolves: int | None = Field(default=None, description="收束的章节号；跨卷则为 null")


class PowerLimit(Model):
    ability: str = Field(description="能力 id")
    rule: str = Field(description="本卷中这个能力最多能做到什么程度")
    sealed: bool = Field(default=False, description="本卷是否完全不能使用")


class ChapterOutline(Model):
    no: int
    title: str
    pov: str = Field(description="视点人物 id")
    function: str = Field(description="本章在全卷起承转结中的作用")
    mode: Literal["daily", "comedy", "romance", "event", "mystery", "battle"]
    tension: int = Field(ge=1, le=5, description="紧张度 1~5")
    summary: str
    cast: list[str] = Field(description="登场角色 id")
    motifs: list[str] = Field(default_factory=list, description="本章出现的母题 id")
    hook: str = Field(description="章末引子：让读者想翻下一章的东西")


class Structure(Model):
    ki: str = Field(description="起")
    sho: str = Field(description="承")
    ten: str = Field(description="转")
    ketsu: str = Field(description="结")


class VolumeOutline(Model):
    volume: int
    title: str
    premise: str = Field(description="本卷一句话")
    theme_angle: str = Field(description="本卷如何回应作品主题")
    structure: Structure
    climax_chapter: int
    mysteries_raised: list[str] = Field(default_factory=list, description="本卷提出的谜团 id")
    mysteries_answered: list[str] = Field(default_factory=list, description="本卷解答的谜团 id")
    power_limits: list[PowerLimit]
    foreshadows: list[Foreshadow]
    twists: list[Twist]
    threads: list[Thread]
    chapters: list[ChapterOutline]


# -------------------------------------------------------- chapter plan (细纲)


class Scene(Model):
    no: int
    pov: str = Field(description="视点人物 id")
    location: str
    time: str
    cast: list[str] = Field(description="在场角色 id")
    goal: str = Field(description="视点人物在这一场想要什么")
    conflict: str = Field(description="阻碍")
    outcome: str = Field(description="结果，最好是『成功了，但是……』或『失败了，而且……』")
    emotion_start: str
    emotion_end: str
    beats: list[str] = Field(description="4~8 个节拍：具体发生什么，不要写成正文")
    plants: list[str] = Field(default_factory=list, description="本场埋下或二次提醒的伏笔 id")
    payoffs: list[str] = Field(default_factory=list, description="本场回收的伏笔 id")
    reveals: list[str] = Field(
        default_factory=list, description="本场让读者知道答案的谜团 id（视点人物自己推理出来也算）")
    abilities_used: list[str] = Field(default_factory=list, description="本场使用的能力 id")
    motifs: list[str] = Field(default_factory=list, description="本场出现的母题 id")
    key_line: str = Field(default="", description="本场的关键台词，可留空")
    target_chars: int = Field(description="目标字数")


class ChapterPlan(Model):
    volume: int
    chapter: int
    scenes: list[Scene]


# -------------------------------------------------------------- ledger (状态账本)


class Fact(Model):
    about: list[str] = Field(description="涉及的角色 id")
    text: str


class AbilityShown(Model):
    ability: str = Field(description="能力 id")
    what: str = Field(description="正文中实际做到了什么程度")


class Learned(Model):
    character: str
    learned: str


class Digest(Model):
    summary: str = Field(description="150~300 字的场景摘要，写清发生了什么、关系和情绪如何变化")
    appearances: list[str] = Field(description="正文中实际出场的角色 id")
    new_facts: list[Fact] = Field(description="正文新确立、之后必须保持一致的事实")
    abilities_shown: list[AbilityShown] = Field(default_factory=list)
    address_terms: list[AddressTerm] = Field(
        default_factory=list, description="正文中出现的、与称呼表不同的新称呼"
    )
    knowledge: list[Learned] = Field(default_factory=list, description="角色新得知的重要信息")
    plants_landed: list[str] = Field(default_factory=list, description="正文中确实出现了表面细节的伏笔 id")
    payoffs_landed: list[str] = Field(default_factory=list, description="正文中确实完成回收的伏笔 id")
    beats_missing: list[int] = Field(default_factory=list, description="正文没有写到的节拍序号（从 1 开始）")
    unplanned_events: list[str] = Field(default_factory=list, description="节拍里没有、但正文写了的重大事件")
    ooc: list[str] = Field(default_factory=list, description="角色说话或行为不符合设定的地方")
    open_questions: list[str] = Field(default_factory=list, description="读者读完这一场会产生的新疑问")


class SceneRecord(Model):
    volume: int
    chapter: int
    scene: int
    digest: Digest


class Ledger(Model):
    scenes: list[SceneRecord] = Field(default_factory=list)
