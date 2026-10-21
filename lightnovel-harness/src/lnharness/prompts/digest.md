# 任务
你是轻小说编辑部的校对。阅读下面的场景正文，对照这一场的细纲，提取连续性信息。只依据正文实际写出的内容判断，不要推测正文里没有的东西。

# 角色 id
$characters

# 能力 id
$abilities

# 当前称呼表
$addresses

# 这一场的细纲
视点人物想要：$goal
阻碍：$conflict
结果：$outcome

节拍：
$beats

计划埋下或提醒的伏笔：
$plants

计划回收的伏笔：
$payoffs

计划使用的能力：$abilities_used

# 判断标准
- plants_landed / payoffs_landed：只有当正文里确实出现了对应的细节或回收时才列入。
- beats_missing：正文完全没有写到的节拍序号。
- unplanned_events：只列出改变了后续剧情前提（人物关系、秘密、谁知道了什么、物品或伤势状态）、并且节拍和结果里都没有写到的事件。对节拍的展开、动机和推理过程的具体化、小道具和小动作都不算。拿不准时不要列。
- ooc：角色的言行明显违背其设定的地方。
- address_terms：只列出与当前称呼表不同的新称呼。

# 场景正文
$prose
