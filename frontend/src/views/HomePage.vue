<template>
  <div class="landing-page">
    <!-- TOP BAR -->
    <div class="topbar" data-testid="home-topbar">
      <a class="brand" href="/">
        <span class="brand-mark">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
            <rect x="5" y="7" width="22" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <line x1="5" y1="13" x2="27" y2="13" stroke="currentColor" stroke-width="1.5"/>
            <line x1="5" y1="17" x2="27" y2="17" stroke="currentColor" stroke-width="1.5"/>
            <line x1="5" y1="21" x2="27" y2="21" stroke="currentColor" stroke-width="1.5"/>
            <rect x="20" y="5" width="4" height="6" rx="1" fill="currentColor"/>
            <polygon points="22,11 20,13 24,13" fill="currentColor"/>
            <polygon points="12,10 12,18 18,14" fill="currentColor"/>
          </svg>
        </span>
        <span class="brand-text">
          <strong>历史短视频工坊</strong>
          <span>History Video Forge</span>
        </span>
      </a>
      <div class="topbar-right">
        <div class="topbar-actions">
          <button class="btn btn-ghost" data-testid="home-primary-cta" @click="router.push('/projects')">我的项目</button>
          <button class="btn btn-primary" @click="handleCreateProject">新建项目</button>
        </div>
        <div class="topbar-divider" aria-hidden="true"></div>
        <div class="account-actions">
          <button class="account-btn login-btn">登录</button>
          <button class="account-btn settings-btn" aria-label="设置" title="设置">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.86l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.86-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.86.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04a1.7 1.7 0 0 0-.34-1.86 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.04A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.86l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 8.95 3a1.7 1.7 0 0 0 1.03-1.56V1a2 2 0 1 1 4 0v.44A1.7 1.7 0 0 0 15.01 3a1.7 1.7 0 0 0 1.86-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.04A1.7 1.7 0 0 0 19.4 15z"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- HERO -->
    <section class="hero" data-testid="home-hero">
      <div class="landing-container">
        <h1 class="hero-title" data-testid="home-heading">历史短视频工坊</h1>
        <p class="hero-subtitle">History Video Forge</p>

        <div class="hero-cta">
          <button class="btn-large btn-large-primary" @click="handleCreateProject">
            新建项目
            <span class="arrow">→</span>
          </button>
          <button class="btn-large btn-large-ghost">
            观看示例
          </button>
        </div>

        <div class="hero-tagline" data-testid="home-tagline">自动创意 · 零思考 · 零手工 · 一键产出短视频</div>

        <!-- 齿轮动画 -->
        <div class="factory-decoration">
          <div v-for="i in 3" :key="i" class="gear-icon">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </div>
        </div>

        <!-- 传送带动画 -->
        <div class="conveyor">
          <div class="conveyor-box"></div>
          <div class="conveyor-box"></div>
          <div class="conveyor-box"></div>
          <div class="conveyor-box"></div>
          <div class="conveyor-box"></div>
          <div class="conveyor-box"></div>
        </div>
      </div>
    </section>

    <!-- WORKFLOW: PIPELINE + ROLES -->
    <section class="section workflow-section">
      <div class="landing-container">
        <div class="section-header fade-in">
          <div class="section-tag">One Creator · Complete Workflow</div>
          <h2 class="section-title"><span class="line-1">不需要专业团队</span><em>你，单人搞定一切</em></h2>
          <p class="section-desc">七个步骤，环环相扣；六个角色，一手承担。从一个模糊的历史念头，到一段完整可发布的视频。</p>
        </div>

        <!-- Pipeline Flow (4+3) -->
        <div class="pipeline-flow" data-testid="home-feature-rail">
          <!-- 阶段 1：选题 -->
          <div class="pipeline-stage fade-in">
            <div class="stage-icon">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            </div>
            <div class="stage-name">选题</div>
            <div class="stage-role">创意总监</div>
            <div class="stage-desc">候选评估、确定主题</div>
          </div>
          <!-- 阶段 2：文案 -->
          <div class="pipeline-stage fade-in">
            <div class="stage-icon">
              <svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L9 19l9-6z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
            </div>
            <div class="stage-name">文案</div>
            <div class="stage-role">编剧</div>
            <div class="stage-desc">生成口播首稿</div>
          </div>
          <!-- 阶段 3：分镜 -->
          <div class="pipeline-stage fade-in">
            <div class="stage-icon">
              <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            </div>
            <div class="stage-name">分镜</div>
            <div class="stage-role">分镜师</div>
            <div class="stage-desc">镜头拆分、定义功能</div>
          </div>
          <!-- 阶段 4：素材 -->
          <div class="pipeline-stage fade-in">
            <div class="stage-icon">
              <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
            </div>
            <div class="stage-name">素材</div>
            <div class="stage-role">摄影指导</div>
            <div class="stage-desc">挑选图片视频</div>
          </div>
          <!-- 阶段 5：合成 -->
          <div class="pipeline-stage fade-in">
            <div class="stage-icon">
              <svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            </div>
            <div class="stage-name">合成</div>
            <div class="stage-role">录音 / 剪辑</div>
            <div class="stage-desc">时间线编排、音轨合成</div>
          </div>
          <!-- 阶段 6：渲染 -->
          <div class="pipeline-stage fade-in">
            <div class="stage-icon">
              <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
            <div class="stage-name">渲染</div>
            <div class="stage-role">—</div>
            <div class="stage-desc">导出视频、预览成片</div>
          </div>
          <!-- 阶段 7：发布 -->
          <div class="pipeline-stage fade-in">
            <div class="stage-icon">
              <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </div>
            <div class="stage-name">发布</div>
            <div class="stage-role">发行 / 制片</div>
            <div class="stage-desc">元数据整理、平台交付</div>
          </div>
        </div>

        <!-- harness 兼容性钩子 -->
        <p class="flow-strip-compat" data-testid="home-flow-strip">从选题生成到视频渲染导出，全流程一站式完成。</p>

        <!-- Why It Works -->
        <div class="section-header fade-in">
          <div class="section-tag">Why It Works</div>
          <h2 class="section-title">不再靠抽卡，<em>而是一条可审校的生产线</em></h2>
          <p class="section-desc">工坊把历史短视频拆成可控的中间产物：主题、故事简报、口播文案、分镜、素材需求、时间线与成片。每一步都能检查、修改，回退，而不是把结果完全交给黑盒。</p>
        </div>

        <div class="capability-grid fade-in">
          <div class="cap-card">
            <div class="cap-number">01</div>
            <h3>选题有判断</h3>
            <p>不是随机找历史故事，而是评估冲突、反转、人物关系、传播钩子与成片可视化空间。</p>
          </div>
          <div class="cap-card">
            <div class="cap-number">02</div>
            <h3>文案可审校</h3>
            <p>生成适合短视频口播的故事结构，并保留事实边界、叙事目标和可人工修订的中间稿。</p>
          </div>
          <div class="cap-card">
            <div class="cap-number">03</div>
            <h3>分镜结构化</h3>
            <p>把文案拆成镜头，明确每个镜头的画面功能、素材需求、字幕位置和节奏作用。</p>
          </div>
          <div class="cap-card">
            <div class="cap-number">04</div>
            <h3>成片自动化</h3>
            <p>自动整理素材，配音、字幕和时间线，最终输出可预览、可复用、可继续优化的视频项目。</p>
          </div>
        </div>

        <!-- 项目控制台预览 -->
        <div class="console-shell fade-in">
          <div class="console-top">
            <div class="traffic"><span></span><span></span><span></span></div>
            <div class="console-title">Forge Console · Project #082</div>
            <div></div>
          </div>

          <div class="console-body">
            <div class="panel project-card">
              <h3>《晏子使楚》：一句话，如何让楚王当场下不来台？</h3>
              <div class="project-meta">
                <span class="tag">春秋</span>
                <span class="tag">外交博弈</span>
                <span class="tag">强反转</span>
              </div>

              <div class="script-box">
                <p>
                  <strong>口播片段：</strong>
                  楚王以为，羞辱一个矮小的使臣很容易。可他没想到，晏子只用一句话，就把羞辱变成了反击。
                </p>
              </div>

              <div class="pulse-line"></div>

              <div class="timeline">
                <div class="timeline-item">
                  <div class="status-dot">✓</div>
                  <div><b>选题评估</b><br><span>冲突清晰，适合短视频开场</span></div>
                  <div class="progress"><i style="width:100%"></i></div>
                </div>
                <div class="timeline-item">
                  <div class="status-dot">✓</div>
                  <div><b>文案生成</b><br><span>3 段式叙事结构，口播感强</span></div>
                  <div class="progress"><i style="width:100%"></i></div>
                </div>
                <div class="timeline-item">
                  <div class="status-dot">✓</div>
                  <div><b>分镜设计</b><br><span>12 个镜头，平均时长 3.5 秒</span></div>
                  <div class="progress"><i style="width:100%"></i></div>
                </div>
                <div class="timeline-item">
                  <div class="status-dot">✓</div>
                  <div><b>素材匹配</b><br><span>12 个镜头素材已匹配</span></div>
                  <div class="progress"><i style="width:100%"></i></div>
                </div>
                <div class="timeline-item">
                  <div class="status-dot">→</div>
                  <div><b>合成与渲染</b><br><span>正在编译时间线与字幕</span></div>
                  <div class="progress"><i style="width:60%"></i></div>
                </div>
              </div>
            </div>

            <div class="panel video-card">
              <div class="phone">
                <div class="phone-screen">
                  <div class="video-title">9:16 预览 · 00:18</div>
                  <div class="moon"></div>
                  <div class="silhouette"></div>
                  <div class="caption">"楚国无人了吗？怎么派你这样的人来？"</div>
                </div>
              </div>
              <div class="render-badge">
                <span>当前状态</span>
                <b>素材匹配中</b>
              </div>
            </div>

            <div class="floating-card score-card">
              <small>传播潜力评分</small>
              <div class="score-row">
                <strong>91</strong>
                <span>强冲突 / 高反转</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="section cta-section">
      <div class="landing-container">
        <div class="section-header">
          <h2>你的第一个<em>历史视频</em>项目<br>从现在开始</h2>
          <p>不需要懂技术，不需要多人团队。<br>一个选题，一段历史，就是全部的起点。</p>
          <button class="btn-large btn-large-primary" @click="handleCreateProject">
            新建项目
            <span class="arrow">→</span>
          </button>
        </div>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="landing-footer">
      <span class="footer-meta">版本号：v1.0.0</span>
      <span class="footer-meta">联系邮箱：<a href="mailto:1451784145@qq.com" style="color: var(--text-muted); text-decoration: none;">1451784145@qq.com</a></span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";

import { useProjectStore } from "../stores/project";

const projectStore = useProjectStore();
const router = useRouter();

async function handleCreateProject() {
  const project = await projectStore.createProject();
  await router.push(
    projectStore.resolveProjectWorkspacePath(
      project.project_id,
      project.current_status,
    ),
  );
}

let observer: IntersectionObserver | undefined;

onMounted(() => {
  document.body.classList.add("landing-page-bg");

  // Scroll-in animation for fade-in elements
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
        }
      });
    },
    { threshold: 0.15 },
  );
  document.querySelectorAll(".landing-page .fade-in").forEach((el) => {
    observer!.observe(el);
  });
});

onUnmounted(() => {
  document.body.classList.remove("landing-page-bg");
  if (observer) {
    observer.disconnect();
    observer = undefined;
  }
});
</script>

<style scoped>
/* 所有样式在 landing-page.css 中全局生效；此处保留 scoped 块以维持组件结构 */
</style>
