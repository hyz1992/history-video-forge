import { describe, it, expect } from 'vitest';
import { buildPricingCatalogSeed } from '../../../backend/src/modules/generation-cost/pricing-catalog.seed.js';
import { evaluateGenerationCapabilityReadiness } from '../../../backend/src/modules/generation-cost/generation-capability-readiness.js';
const model='minimax_h3_lightx2v_v5';
describe('AutoDL目录',()=>{
 it('非默认候选有独立参数与价格',()=>{
 const catalog=buildPricingCatalogSeed({llm:{mode:'stub'},media:{deploymentScope:'cn-beijing',includeAutodl:true}});
 const row=catalog.find(x=>x.providerKey==='autodl');
 expect(row).toBeDefined();expect(row?.isDefault).toBe(false);
 expect(row?.modelId).toBe(model);
 expect(row?.parameterCapabilitiesJson.max_duration_seconds_per_task).toBe(10);
 expect(row?.pricingJson.price_micros_per_second_by_quality).toEqual({standard_720p:'40000',high_1080p:'90000'});
 });
 it('独立凭据控制就绪，不使用DashScope凭据',()=>{
 const catalog=buildPricingCatalogSeed({llm:{mode:'stub'},media:{deploymentScope:'cn-beijing',includeAutodl:true}});
 const row=catalog.find(x=>x.providerKey==='autodl');expect(row).toBeDefined();
 for(const configured of [true,false]){
 const result=evaluateGenerationCapabilityReadiness({catalog,llm:{mode:'stub'},media:{registeredModels:[{capability:'video.image_to_video',providerKey:'autodl',modelId:model}],credentialConfigured:false,deploymentScope:'cn-beijing',credentialConfiguredByProvider:{autodl:configured}},environment:{testEnv:false}});
 expect(result.items[row!.id].quotable).toBe(configured);
 }
 });
});
