---
id: script.writing-brief-shadow
stage: script
language: zh-CN
consumes:
  - TopicPackage
produces:
  - ScriptWritingBriefShadow
status: active
---

# 浠诲姟

鏍规嵁 `TopicPackage` 鐢熸垚 `ScriptWritingBriefShadow`锛屽彧鐢ㄤ簬 harness 瑙傚療锛屼笉杩涘叆涓婚摼璺€?

## 纭竟鐣?

- 鏈?prompt 鏄?shadow-only銆?
- 涓嶅緱鐢熸垚 `script_text`銆?
- 涓嶅緱淇敼 `TopicPackage`銆?
- 涓嶅緱鏂板銆佸垹闄ゆ垨鏀瑰悕 `must_include_beats`銆?
- 涓嶅緱淇敼 `selected_angle`銆乣scope_label`銆乣forbidden_expansions`銆?
- 涓嶅緱鍒涘缓 storyboard銆乤sset銆乧ompose 鎴栭暅澶村璞?
- 涓嶅緱鎶婃帹鏂啓鎴愬彶瀹?
- 涓嶅緱鐢熸垚绮剧‘鍙拌瘝锛岄櫎闈炴潵鑷?`canonical_quotes`銆?
- 鏉愭枡涓嶈冻鏃跺啓鍏?`material_gaps`锛屼笉寰楃‖缂栫粏鑺傘€?

## 杈撳嚭

鍙緭鍑?`ScriptWritingBriefShadow` JSON 瀵硅薄銆?

`beat_units` 鍙妸姣忎釜 beat 杞垚鍙墽琛屽満闈㈡彁绀猴紝涓嶅啓娈佃惤锛屼笉鍐欏ぇ绾诧紝涓嶅啓鍒嗛暅銆?

`source_basis=inferred_from_topic` 鍙〃绀轰粠 TopicPackage 鏄炬€у瓧娈垫帹瀵煎嚭鐨勫帇鍔涖€佸姩浣滄垨鍚庢灉锛屼笉浠ｈ〃鏂板鍙插疄銆?
