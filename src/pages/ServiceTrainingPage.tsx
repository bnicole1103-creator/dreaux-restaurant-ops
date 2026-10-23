import {PageWord} from '../components/PageDesign'
import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {loadTenantData} from '../lib/tenant'
import {TrainingLibrary} from '../components/TrainingLibrary'
import {TrainingMaterials} from '../components/TrainingMaterials'
import {AccessSection} from '../components/AppAccess'
import {DesignSection} from '../components/DesignSection'
import './TrainingPage.css'
export function ServiceTrainingPage(){
 const [location,setLocation]=useState(''),[manager,setManager]=useState(false),[error,setError]=useState(''),[tab,setTab]=useState<'documents'|'guides'|'quizzes'>('documents'),[selected,setSelected]=useState<string[]>([]),[source,setSource]=useState('')
 useEffect(()=>{let live=true;void(async()=>{try{const t=await loadTenantData(),id=t.locations[0]?.id;if(!id)throw Error('No active location.');const r=await supabase.rpc('closeout_is_gm',{p_location_id:id});if(r.error)throw r.error;if(live){setLocation(id);setManager(r.data===true)}}catch(e){if(live)setError((e as Error).message)}})();return()=>{live=false}},[])
 return <DesignSection as="section" data-design-block="training.service.workspace" className="page training-page"><Link to="/training"><PageWord id="training.content.9e34655c4bcb4be4">{"← Training"}</PageWord></Link><h1><PageWord id="training.content.275406cf654d8f82">{"Service Guides"}</PageWord></h1>{error&&<p role="alert">{error}</p>}{!location&&!error&&<p role="status"><PageWord id="training.content.b12ce3e6b2e862da">{"Loading training…"}</PageWord></p>}<nav className="training-categories" aria-label="Service training workspace">{([['documents','Documents'],['guides','Study Guides'],['quizzes','Quizzes']] as const).map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>{setSource('');setTab(key)}}>{label}</button>)}</nav>{location&&(tab==='documents'?<TrainingLibrary location={location} shelf="service" manager={manager} selected={selected} onSelect={setSelected} onGenerate={(text,next)=>{setSource(text);setTab(next)}}/>:<AccessSection page="training" section={tab}><TrainingMaterials key={tab} location={location} kind="service" tab={tab} recipes={[]} selected={[]} manager={manager} onRecipes={()=>setTab('documents')} initialSource={source}/></AccessSection>)}</DesignSection>
}
