import type {Config,Question} from '../components/CloseoutConfig'
const legacyIndividual=(q:Question)=>q.audience==='manager'&&!q.builtin&&q.type==='number'&&/\bsales\b/i.test(q.label)&&/\b(individual|personal|your|own)\b/i.test(q.label)
export function managerExtraConfig(config:Config|null):Config|null{return config?{...config,questions:config.questions.filter(q=>!legacyIndividual(q))}:null}
export function managerLegacySalesAnswers(config:Config|null,individual:string){return Object.fromEntries((config?.questions??[]).filter(q=>q.active&&legacyIndividual(q)).map(q=>[q.id,individual]))}
