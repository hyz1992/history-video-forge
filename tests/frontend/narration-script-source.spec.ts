// @vitest-environment jsdom
import {mount,flushPromises} from '@vue/test-utils';
import {reactive} from 'vue';
import {it,expect,vi,afterEach} from 'vitest';
import ElementPlus from 'element-plus';
import ScriptPanel from '../../frontend/src/components/script/ScriptPanel.vue';
import NarrationPanel from '../../frontend/src/components/script/NarrationPanel.vue';
import {projectStoreKey} from '../../frontend/src/stores/project';
import {scriptStoreKey} from '../../frontend/src/stores/script';
import {workspaceStoreKey} from '../../frontend/src/stores/workspace';
import {createAppRouter} from '../../frontend/src/router';
afterEach(()=>vi.unstubAllGlobals());
const draft=(id:string)=>({script_record_id:id,script_text:'正文'+id,estimated_duration_sec:4,local_validation:{decision:'pass'},semantic_review:{decision:'skipped'},execution_state:{patch_used:false,regenerate_used:false}});
for(const initial of [null,'old'])it('正文来源自动同步 '+initial,async()=>{
 const state:any=reactive({snapshot:{project_id:'p',current_status:'script_ready',narration_timing_mode:'narration_first_v1',active_script:initial?draft(initial):null},history:[],selectedHistoryEntryId:null,isLoading:false,isRunningAction:false,loadError:null});
 const fetchMock=vi.fn(async(url:string)=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>url.endsWith('/context')?{mode:'narration_first_v1',source_script_record_id:state.snapshot.active_script?.script_record_id??null,source_text_sha256:'a'.repeat(64),options:[],configuration:null}: {project_id:'p',narration_readiness:{ready:false}}}));vi.stubGlobal('fetch',fetchMock);
 const router=createAppRouter();await router.push('/projects/p/script');
 const wrapper=mount(ScriptPanel,{global:{plugins:[router,ElementPlus],provide:{[projectStoreKey as symbol]:{state:reactive({projectId:'p',projects:[]}),loadProject:async()=>{}},[workspaceStoreKey as symbol]:{setCurrentStep:vi.fn()},[scriptStoreKey as symbol]:{state,loadActiveScriptSnapshot:async()=>{},generateInitialScript:async()=>{state.snapshot.active_script=draft('new');},runRegenOnce:async()=>{},selectHistoryEntry:()=>{}}}}});
 await flushPromises();if(initial){state.snapshot.active_script=draft('new');await flushPromises();}
 expect(wrapper.findComponent(NarrationPanel).props('store').state.context.source_script_record_id).toBe('new');wrapper.unmount();
});
