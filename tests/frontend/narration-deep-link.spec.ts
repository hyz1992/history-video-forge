// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {apiFetch} from '../../frontend/src/utils/api';
import {createAppRouter} from '../../frontend/src/router';
vi.mock('../../frontend/src/utils/api',()=>({apiFetch:vi.fn()}));
it('新项目未确认口播深链回文案',async()=>{vi.mocked(apiFetch).mockResolvedValue({narration_timing_mode:'narration_first_v1',narration_readiness:{ready:false}});const r=createAppRouter();await r.push('/projects/p/storyboard');expect(r.currentRoute.value.path).toBe('/projects/p/script');});
it('历史分镜仍可浏览，legacy不受新门禁影响',async()=>{vi.mocked(apiFetch).mockResolvedValue({narration_timing_mode:'narration_first_v1',narration_readiness:{ready:false},active_storyboard:{id:'sb'}});const r=createAppRouter();await r.push('/projects/p/storyboard');expect(r.currentRoute.value.path).toBe('/projects/p/storyboard');vi.mocked(apiFetch).mockResolvedValue({narration_timing_mode:'legacy_estimated'});await r.push('/projects/q/asset');expect(r.currentRoute.value.path).toBe('/projects/q/asset');});

it('新路径活动资产可继续浏览',async()=>{vi.mocked(apiFetch).mockResolvedValue({narration_timing_mode:'narration_first_v1',narration_readiness:{ready:false},active_assets:{id:'m'}});const r=createAppRouter();await r.push('/projects/p/asset');expect(r.currentRoute.value.path).toBe('/projects/p/asset');});
