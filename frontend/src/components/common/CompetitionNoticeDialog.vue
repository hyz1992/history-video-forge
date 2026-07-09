<script setup lang="ts">
import { useRouter } from "vue-router";
import { ElButton, ElDialog } from "element-plus";
import { showCompetitionNotice, useCompetitionGuard } from "../../composables/useCompetitionGuard";

const router = useRouter();
const { MAX_PROJECTS } = useCompetitionGuard();

const DEMO_PROJECT_ID = "052a0c19-8723-4d91-8d27-89789a54c5e4";

function goToProjects() {
  showCompetitionNotice.value = false;
  router.push("/projects");
}

function goToDemoProject() {
  showCompetitionNotice.value = false;
  router.push(`/projects/${DEMO_PROJECT_ID}/compose-render`);
}

function close() {
  showCompetitionNotice.value = false;
}
</script>

<template>
  <el-dialog
    :model-value="showCompetitionNotice"
    @close="close"
    title="比赛演示模式"
    width="480px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    center
  >
    <div class="competition-notice">
      <div class="competition-icon">🏆</div>
      <p class="competition-text">
        您正在使用<strong>比赛演示模式</strong>。
      </p>
      <p class="competition-text">
        该模式下最多只能创建 <strong>{{ MAX_PROJECTS }}</strong> 个项目，
        且不支持重新合成渲染。
      </p>
      <p class="competition-hint">
        欢迎查看已完成的示例项目，体验完整的合成渲染与发布交付流程。
      </p>
    </div>

    <template #footer>
      <div class="competition-footer">
        <el-button type="default" @click="goToProjects">
          我的项目
        </el-button>
        <el-button type="primary" @click="goToDemoProject">
          查看安史之乱示例
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.competition-notice {
  text-align: center;
  padding: 8px 0 16px;
}

.competition-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.competition-text {
  font-size: 15px;
  color: #4a4238;
  line-height: 1.7;
  margin: 0 0 6px;
}

.competition-hint {
  font-size: 13px;
  color: #8b7e6a;
  margin-top: 12px;
}

.competition-footer {
  display: flex;
  gap: 12px;
  justify-content: center;
}
</style>
