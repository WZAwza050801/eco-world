# 04 术语与量纲

> 来源：契约 §1.2 与附录 A（冻结）。单位制详情见 `00-design-contract.md` §1。

| 术语 | 含义 |
|---|---|
| cell | 逻辑地理单元，默认 10 km 见方 |
| tick | 一次生态更新，默认 1 天 |
| kgC | 千克碳，生物量干重单位 |
| GPP | 总初级生产力 |
| Holling II | 捕食功能响应函数 |
| SIR | 易感-感染-康复模型 |
| 快照 | 某一时刻的完整世界状态，不可变 |
| 双缓冲 | 读旧写新、统一提交的更新方式 |
| 因果链 | 事件的原因—结果记录 |

量纲速查：时间 day（year = 365 day）；空间 cell（边长 10 km）；面积 km²（cell = 100 km²）；生物量 kgC；种群 individuals/cell；能量 kJ；温度 °C；降水 mm/day；水储量 mm；营养 kgN/cell；质量 kg；距离 km；密度 individuals/km²。
