<script setup lang="ts">
import { computed } from "vue";

/**
 * S2-2A 任务 11：严格模式（all_api_video）API 失败对话框。
 * 提供「重试 API（重新报价）」与「明确接受 Remotion 版本」两个动作；
 * 接受 fallback 需要 run id 与 manifest 版本（expected_version，CAS 防并发覆盖）。
 */

const props = defineProps<{
  open: boolean;
  segmentLabel: string;
  failureReason: string;
  /** 正在执行中的 run id（execution_state.run_id）。 */
  runId: string | null;
  /** 当前 manifest 版本（active_assets.version，accept-fallback 的 expected_version）。 */
  manifestVersion: string | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: "retry"): void;
  (e: "acceptFallback"): void;
  (e: "cancel"): void;
}>();

const canAcceptFallback = computed(() => props.runId !== null && props.manifestVersion !== null);
</script>

<template>
  <el-dialog
    :model-value="open"
    title="严格模式：API 视频失败"
    width="520px"
    @update:model-value="(value: boolean) => !value && emit('cancel')"
  >
    <div class="strict-body">
      <p>
        分镜 <strong>{{ segmentLabel }}</strong> 的 API 视频生成失败，当前策略为「全部使用 API 视频」
        （严格模式），不会自动降级：
      </p>
      <pre class="strict-reason">{{ failureReason }}</pre>
      <el-alert
        v-if="!canAcceptFallback"
        type="warning"
        :closable="false"
        title="暂无法接受 Remotion 版本"
        description="缺少本次运行的执行上下文（run id / manifest 版本），请先重试 API 生成。"
        show-icon
      />
      <el-alert
        type="info"
        :closable="false"
        title="接受 Remotion 版本的含义"
        description="该分镜将使用已生成的图片 + 本地运镜（image-with-motion）继续流程，费用按实际使用结算；此决定会记录在运行事件中。"
        show-icon
      />
    </div>
    <template #footer>
      <button class="btn btn-ghost" @click="emit('cancel')">稍后处理</button>
      <button
        class="btn btn-primary"
        data-testid="strict-retry"
        :disabled="busy"
        @click="emit('retry')"
      >
        重试 API（重新报价）
      </button>
      <button
        class="btn btn-fallback"
        data-testid="strict-accept-fallback"
        :disabled="busy || !canAcceptFallback"
        @click="emit('acceptFallback')"
      >
        明确接受 Remotion 版本
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
.strict-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  color: #d8d0c7;
  line-height: 1.6;
}

.strict-reason {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(224, 122, 95, 0.07);
  border: 1px solid rgba(224, 122, 95, 0.25);
  color: #e0a883;
  font-size: 12px;
  white-space: pre-wrap;
}

.btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  border: none;
  font-family: inherit;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.018);
  border: 1px solid rgba(201, 162, 39, 0.13);
  color: #a89f94;
  margin-right: 10px;
}

.btn-primary {
  background: rgba(201, 162, 39, 0.16);
  border: 1px solid rgba(201, 162, 39, 0.4);
  color: #f5f0e8;
}

.btn-fallback {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(201, 162, 39, 0.3);
  color: #c9a227;
  margin-left: 8px;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
