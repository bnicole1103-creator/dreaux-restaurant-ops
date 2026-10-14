// This module accepts a narrow PostgREST read grammar, never arbitrary SQL.
export const READ_TABLES=new Set(['floor_tables','location_memberships','locations','organization_memberships','organizations','profiles','reservations','rooms','rotation_counters','rotation_log','section_configurations','server_assignments','shift_section_tables','shift_sections','shifts','table_session_tables','table_sessions'])
export const READ_RPCS=new Set(['app_decorations_get','calendar_day_posts','calendar_read','calendar_reservations','app_appearance_get','closeout_automatic_target','closeout_get_config','closeout_is_gm','closeout_manager_answers','closeout_manager_submission','closeout_peer_recognition','closeout_permission_roster','closeout_summary_archive','closeout_summary_day','floor_closeout_history','floor_schedule_list','floor_sections_for_day','guest_feedback_config','guest_feedback_inbox','inquiry_combined_host_load','inventory_disposal_load','inventory_disposal_summary_day','inventory_receipt_report','manager_recap_reports','mod_get_closeout','mod_is_manager','mod_points_dashboard','page_design_load','points_gm_entries','preshift_activity_report','preshift_archive','preshift_drafts_list','preshift_feed','preshift_presets','preshift_read_status','preshift_reservation_context','push_post_notification_settings','push_preferences','quiz_manager_load','quiz_manager_roster','quiz_question_bank_by_day','quiz_staff_load','quiz_staff_month','reservation_inquiry_load','sales_target_inputs','sales_target_locked_day','screen_wording_get','staff_my_obligations','staff_notifications_settings','staff_push_config','staff_signup_status','staff_tasks_can_manage','staff_tasks_day','staff_tasks_templates','stock_board_load','stock_closeout_items','team_closeout_detail','team_employee_profile','training_cocktails_load','walkin_config','walkin_list','staff_layout_load','staff_view_schedule','disposal_requirements_day'])
export function identifier(value:string){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))throw Error('Unsupported preview identifier.');return '"'+value+'"'}
function split(value:string){const out:string[]=[];let depth=0,start=0,quoted=false;for(let i=0;i<value.length;i++){if(value[i]==='"')quoted=!quoted;if(quoted)continue;if(value[i]==='(')depth++;if(value[i]===')')depth--;if(depth<0)throw Error('Invalid preview filter.');if(value[i]===','&&depth===0){out.push(value.slice(start,i));start=i+1}}if(depth||quoted)throw Error('Invalid preview filter.');out.push(value.slice(start));return out}
export function tableRead(table:string,query:string,location:string,organization:string,target:string,booleanColumns:ReadonlySet<string>=new Set()){
 if(!READ_TABLES.has(table))throw Error('This table is not supported in staff preview.')
 const params:unknown[]=[],bind=(v:unknown)=>{params.push(v);return '$'+params.length},url=new URLSearchParams(query),where:string[]=[]
 const filter=(field:string,value:string):string=>{
  if(field==='or'||field==='and'){if(!value.startsWith('(')||!value.endsWith(')'))throw Error('Invalid preview filter.');return '('+split(value.slice(1,-1)).map(v=>{const i=v.indexOf('.');return filter(v.slice(0,i),v.slice(i+1))}).join(field==='or'?' OR ':' AND ')+')'}
  const bindFilter=(v:string)=>{if(!booleanColumns.has(field))return bind(v);if(v==='true'||v==='t')return bind(true);if(v==='false'||v==='f')return bind(false);throw Error('Use true or false for boolean preview filters.')};
  const col=identifier(field),negative=value.startsWith('not.');if(negative)value=value.slice(4);const dot=value.indexOf('.'),op=value.slice(0,dot),val=value.slice(dot+1);let sql='';
  const ops:Record<string,string>={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'LIKE',ilike:'ILIKE',cs:'@>',cd:'<@',ov:'&&'}
  if(op==='is'){if(!['null','true','false'].includes(val))throw Error('Unsupported preview filter.');sql=col+' IS '+val.toUpperCase()}
  else if(op==='in'){if(!val.startsWith('(')||!val.endsWith(')'))throw Error('Invalid preview list.');const values=split(val.slice(1,-1)).filter(Boolean);if(values.length>1000)throw Error('Preview list is too large.');sql=values.length?col+' IN ('+values.map(v=>bindFilter(v.replace(/^"(.*)"$/,'$1'))).join(',')+')':'FALSE'}
  else if(ops[op])sql=col+' '+ops[op]+' '+bindFilter(op==='like'||op==='ilike'?val.replace(/\*/g,'%'):val)
  else throw Error('This filter is not supported in staff preview.')
  return negative?'NOT ('+sql+')':sql
 }
 for(const [key,val]of url){if(['select','order','limit','offset'].includes(key))continue;where.push(filter(key,val))}
 if(table==='locations')where.push('id='+bind(location))
 else if(table==='organizations')where.push('id='+bind(organization))
 else if(table==='organization_memberships')where.push('organization_id='+bind(organization))
 else if(table==='profiles')where.push('(id='+bind(target)+' OR id IN (SELECT user_id FROM public.location_memberships WHERE location_id='+bind(location)+'))')
 else if(!['shift_section_tables','table_session_tables'].includes(table))where.push('location_id='+bind(location))
 // Tables without location_id are scoped through their parent foreign keys.
 if(table==='shift_section_tables')where.push('shift_section_id IN (SELECT id FROM public.shift_sections WHERE location_id='+bind(location)+')')
 if(table==='table_session_tables')where.push('table_session_id IN (SELECT id FROM public.table_sessions WHERE location_id='+bind(location)+')')
 const selected=(url.get('select')??'*').replace(/\s+/g,'');
 const columns=selected==='*'?'*':selected.split(',').filter(Boolean).map(v=>{const pair=v.split(':');if(pair.length>2)throw Error('Unsupported preview selection.');return pair.length===2?identifier(pair[1])+' AS '+identifier(pair[0]):identifier(v)}).join(',')
 const order=url.get('order')?.split(',').map(v=>{const [name,dir='asc',nulls]=v.split('.');if(!['asc','desc'].includes(dir)||nulls&&!['nullsfirst','nullslast'].includes(nulls))throw Error('Unsupported preview order.');return identifier(name)+' '+dir+(nulls?' NULLS '+(nulls==='nullsfirst'?'FIRST':'LAST'):'')}).join(',')
 const limit=Number(url.get('limit')??1000),offset=Number(url.get('offset')??0);if(!Number.isInteger(limit)||limit<0||limit>1000||!Number.isInteger(offset)||offset<0||offset>100000)throw Error('Preview range exceeds supported limits.')
 return {sql:'SELECT '+columns+' FROM public.'+identifier(table)+' WHERE '+(where.join(' AND ')||'TRUE')+(order?' ORDER BY '+order:'')+' LIMIT '+limit+' OFFSET '+offset,params}
}
