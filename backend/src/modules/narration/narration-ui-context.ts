import { NarrationUiContext } from '../../../../shared/src/narration/narration-ui.schema.js';
import { NarrationCreativeSettings } from '../../../../shared/src/index.js';
import { NarrationRepository, durationBandFromSource } from './narration.repository.js';
import { narrationTextHash } from './narration-readiness.js';
import { NARRATION_FIRST_MODEL_POLICY_V1 as policy, narrationPolicyErrorForOwner } from './narration-model-policy.js';
import type { DbClient } from '../../db/client.js';
export async function readNarrationUiContext(db:DbClient,projectId:string,ownerId:string) {
 const source=await new NarrationRepository(db).sourceContext(projectId,ownerId);
 const available=await narrationPolicyErrorForOwner(db,ownerId,'narration_selection_required','请选择合格口播配置');
 let band=null;try{band=durationBandFromSource(source.topic?.durationBandJson);}catch{}
 return NarrationUiContext.parse({mode:source.project.narrationTimingMode??'legacy_estimated',source_script_record_id:source.script?.id??null,source_text_sha256:source.script?narrationTextHash(source.script.scriptText):null,target_duration_band:band,configuration_revision:source.configuration?.revision??0,configuration:source.configuration?.configurationJson??null,policy_version:policy.policy_version,recommended_provider_model_id:policy.default_provider_model_id,recommended_voice_profile_id:policy.default_voice_profile_id,options:available.body.options.map(o=>({...o,supported_tones:[NarrationCreativeSettings.shape.tone.value],supported_rates:[NarrationCreativeSettings.shape.rate.value]}))});
}
