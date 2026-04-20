# Topic Script Live Check Checklist

## Release Gate

- 自动化回归通过：`tests/harness/topic-script-regression.test.ts` 与对应 smoke 链路已通过。
- 真实巡检通过：在真实 `.env` 下完成一次 `topic-script-live-check`，确认输出 graph trace、runtime diagnostics、script artifact。
- 手工 spot check 通过：人工抽查 topic candidates、topic package、script draft 与最终 trace 摘要，没有越界到未定 downstream 阶段。

## Notes

- live check 不是默认自动化 gate。
- live check 只服务 `topic + script` 第一阶段的真实试跑与发布前巡检。
