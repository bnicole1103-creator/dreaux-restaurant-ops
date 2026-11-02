BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtextextended('justinis-approved-scoring-policies-v1',0));

DO $requirements$
BEGIN
 IF to_regprocedure('public.quiz_manager_save_v2(uuid,uuid,date,text,text,jsonb,boolean,integer,boolean)') IS NULL
 OR to_regprocedure('public.quiz_reward_value(integer,integer)') IS NULL
 OR to_regprocedure('public.profile_performance_ranks(uuid,uuid,date,date)') IS NULL
 OR to_regprocedure('leaderboard_private.live_dashboard(uuid,date)') IS NULL
 OR to_regprocedure('public.restaurant_game_round_submit(uuid,uuid,text,integer,integer,text)') IS NULL
 OR to_regclass('public.restaurant_game_rounds') IS NULL
 OR to_regclass('public.restaurant_game_weekly_awards') IS NULL THEN
  RAISE EXCEPTION 'Quiz, rank, points and game prerequisites are required. No changes applied.';
 END IF;
END;$requirements$;

CREATE SCHEMA IF NOT EXISTS approved_scoring_private;
REVOKE ALL ON SCHEMA approved_scoring_private FROM PUBLIC,anon,authenticated;

-- Decision 1: corrected answers regrade every existing attempt and its points.
CREATE TABLE IF NOT EXISTS approved_scoring_private.quiz_regrade_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 quiz_id uuid NOT NULL,
 user_id uuid NOT NULL,
 from_version integer,
 to_version integer NOT NULL,
 before_result jsonb NOT NULL,
 after_result jsonb NOT NULL,
 changed_by uuid,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE approved_scoring_private.quiz_regrade_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON approved_scoring_private.quiz_regrade_audit FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION approved_scoring_private.regrade_quiz(p_quiz_id uuid,p_actor uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $regrade$
DECLARE q public.daily_quizzes%rowtype; a public.daily_quiz_attempts%rowtype;
 item jsonb; answer jsonb; details jsonb; next_result jsonb; pos integer; choice integer; score integer; reward integer; changed integer:=0;
BEGIN
 SELECT * INTO q FROM public.daily_quizzes WHERE id=p_quiz_id;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Quiz unavailable for regrading.';END IF;
 FOR a IN SELECT * FROM public.daily_quiz_attempts WHERE quiz_id=q.id FOR UPDATE LOOP
  IF jsonb_typeof(a.answers) IS DISTINCT FROM 'array' OR jsonb_array_length(a.answers)<>jsonb_array_length(q.questions) THEN
   RAISE EXCEPTION 'Attempt answers no longer align with this quiz. Create a replacement quiz instead.';
  END IF;
  pos:=0;score:=0;details:='[]'::jsonb;
  FOR item IN SELECT value FROM jsonb_array_elements(q.questions) LOOP
   answer:=a.answers->pos;
   IF jsonb_typeof(answer) IS DISTINCT FROM 'number' OR (answer#>>'{}') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Stored attempt contains an invalid answer.';
   END IF;
   choice:=(answer#>>'{}')::integer;
   IF choice<0 OR choice>=jsonb_array_length(item->'options') THEN
    RAISE EXCEPTION 'Stored attempt no longer matches the answer choices. Create a replacement quiz instead.';
   END IF;
   IF choice=(item->>'correct')::integer THEN score:=score+1;END IF;
   details:=details||jsonb_build_array(jsonb_build_object(
    'prompt',item->>'prompt','category',item->>'category','selected',item->'options'->choice,
    'correct_answer',item->'options'->((item->>'correct')::integer),
    'correct',choice=(item->>'correct')::integer,'explanation',item->>'explanation'));
   pos:=pos+1;
  END LOOP;
  reward:=public.quiz_reward_value(score,pos);
  next_result:=jsonb_build_object('score',score,'total',pos,'percent',round(100.0*score/nullif(pos,0),1),
   'questions',details,'reward_points',reward,'completion_points',0,'bonus_points',reward,
   'regraded',true,'regraded_at',clock_timestamp());
  INSERT INTO approved_scoring_private.quiz_regrade_audit(
   quiz_id,user_id,from_version,to_version,before_result,after_result,changed_by
  ) VALUES(q.id,a.user_id,a.quiz_version,q.version,a.result,next_result,p_actor);
  UPDATE public.daily_quiz_attempts SET result=next_result,reward_points=reward,quiz_version=q.version
  WHERE quiz_id=q.id AND user_id=a.user_id;
  changed:=changed+1;
 END LOOP;
 RETURN changed;
END;$regrade$;
REVOKE ALL ON FUNCTION approved_scoring_private.regrade_quiz(uuid,uuid) FROM PUBLIC,anon,authenticated;

DO $quiz_wrap$
BEGIN
 IF to_regprocedure('approved_scoring_private.quiz_manager_save_before_regrade(uuid,uuid,date,text,text,jsonb,boolean,integer,boolean)') IS NULL THEN
  ALTER FUNCTION public.quiz_manager_save_v2(uuid,uuid,date,text,text,jsonb,boolean,integer,boolean)
   SET SCHEMA approved_scoring_private;
  ALTER FUNCTION approved_scoring_private.quiz_manager_save_v2(uuid,uuid,date,text,text,jsonb,boolean,integer,boolean)
   RENAME TO quiz_manager_save_before_regrade;
 END IF;
END;$quiz_wrap$;

CREATE OR REPLACE FUNCTION public.quiz_manager_save_v2(
 p_location_id uuid,p_quiz_id uuid,p_date date,p_title text,p_instructions text,p_questions jsonb,
 p_publish boolean,p_version integer,p_release boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $quiz_save$
DECLARE prior public.daily_quizzes%rowtype; saved jsonb; idx integer; regraded integer:=0;
BEGIN
 SELECT * INTO prior FROM public.daily_quizzes WHERE id=p_quiz_id FOR UPDATE;
 IF prior.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.daily_quiz_attempts WHERE quiz_id=prior.id)
 AND prior.questions IS DISTINCT FROM p_questions THEN
  IF jsonb_typeof(p_questions) IS DISTINCT FROM 'array'
  OR jsonb_array_length(prior.questions)<>jsonb_array_length(p_questions) THEN
   RAISE EXCEPTION 'This quiz has attempts. Keep the same questions and choices when correcting answers, or create a replacement quiz.';
  END IF;
  FOR idx IN 0..jsonb_array_length(prior.questions)-1 LOOP
   IF prior.questions->idx->'options' IS DISTINCT FROM p_questions->idx->'options' THEN
    RAISE EXCEPTION 'This quiz has attempts. Answer choices cannot be added, removed, reordered or renamed. Correct the answer key or create a replacement quiz.';
   END IF;
  END LOOP;
 END IF;
 saved:=approved_scoring_private.quiz_manager_save_before_regrade(
  p_location_id,p_quiz_id,p_date,p_title,p_instructions,p_questions,p_publish,p_version,p_release);
 IF prior.id IS NOT NULL AND prior.questions IS DISTINCT FROM p_questions THEN
  regraded:=approved_scoring_private.regrade_quiz(p_quiz_id,auth.uid());
 END IF;
 RETURN saved||jsonb_build_object('regraded_attempts',regraded);
END;$quiz_save$;

-- Decision 2: rank = 50% points percentile + 25% sales percentile + 25% performance percentile.
CREATE OR REPLACE FUNCTION approved_scoring_private.combine_rank_rows(p_points jsonb,p_metrics jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $combine$
WITH point_rows AS (
 SELECT p.user_id,p.name,p.total,p.rank,
  CASE WHEN count(*) OVER()=1 THEN 100::numeric
   ELSE round(100.0*(count(*) OVER()-p.rank)/nullif(count(*) OVER()-1,0),2) END points_component
 FROM jsonb_to_recordset(coalesce(p_points,'[]'::jsonb)) p(user_id uuid,name text,total integer,rank integer)
), metrics AS (
 SELECT * FROM jsonb_to_recordset(coalesce(p_metrics,'[]'::jsonb))
  m(user_id uuid,sales_rank integer,sales_eligible integer,performance_rank integer,performance_eligible integer)
), scored AS (
 SELECT p.*,
  m.sales_rank,m.sales_eligible,m.performance_rank,m.performance_eligible,
  CASE WHEN m.sales_rank IS NULL THEN NULL WHEN m.sales_eligible=1 THEN 100::numeric
   ELSE round(100.0*(m.sales_eligible-m.sales_rank)/nullif(m.sales_eligible-1,0),2) END sales_component,
  CASE WHEN m.performance_rank IS NULL THEN NULL WHEN m.performance_eligible=1 THEN 100::numeric
   ELSE round(100.0*(m.performance_eligible-m.performance_rank)/nullif(m.performance_eligible-1,0),2) END performance_component
 FROM point_rows p LEFT JOIN metrics m USING(user_id)
), combined AS (
 SELECT *,sales_component IS NOT NULL AND performance_component IS NOT NULL eligible,
  CASE WHEN sales_component IS NOT NULL AND performance_component IS NOT NULL
   THEN round(points_component*.50+sales_component*.25+performance_component*.25,2) END combined_score
 FROM scored
), ranked AS (
 SELECT c.*,CASE WHEN eligible THEN 1+(SELECT count(DISTINCT h.combined_score) FROM combined h
  WHERE h.eligible AND h.combined_score>c.combined_score) END combined_rank FROM combined c
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'user_id',user_id,'name',name,'total',total,'points_rank',rank,'points_component',points_component,
 'sales_rank',sales_rank,'sales_component',sales_component,'performance_rank',performance_rank,
 'performance_component',performance_component,'combined_score',combined_score,'rank',combined_rank,
 'eligible',eligible,'reason',CASE WHEN eligible THEN '' ELSE 'Needs enough sales, manager review, quiz and task history to rank.' END
) ORDER BY eligible DESC,combined_rank NULLS LAST,name),'[]'::jsonb) FROM ranked;
$combine$;
REVOKE ALL ON FUNCTION approved_scoring_private.combine_rank_rows(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION approved_scoring_private.combined_preview(p_location_id uuid,p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $preview$
DECLARE points jsonb; metrics jsonb:='[]'::jsonb; row jsonb; profile jsonb;
 month_start date:=date_trunc('month',p_month)::date; month_end date;
BEGIN
 IF auth.uid() IS NULL OR public.mod_is_manager(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'Management access required.' USING errcode='42501';END IF;
 month_end:=(month_start+interval '1 month'-interval '1 day')::date;
 points:=leaderboard_private.live_dashboard(p_location_id,p_month)->'standings';
 FOR row IN SELECT value FROM jsonb_array_elements(coalesce(points,'[]'::jsonb)) LOOP
  profile:=public.profile_performance_ranks(p_location_id,(row->>'user_id')::uuid,month_start,month_end);
  metrics:=metrics||jsonb_build_array(jsonb_build_object(
   'user_id',row->>'user_id','sales_rank',profile->'sales'->'rank','sales_eligible',profile->'sales'->'eligible',
   'performance_rank',profile->'performance'->'rank','performance_eligible',profile->'performance'->'eligible'));
 END LOOP;
 RETURN approved_scoring_private.combine_rank_rows(points,metrics);
END;$preview$;
REVOKE ALL ON FUNCTION approved_scoring_private.combined_preview(uuid,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.mod_points_dashboard(p_location_id uuid,p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $dashboard$
DECLARE points_live jsonb; preview jsonb:='[]'::jsonb; published jsonb; mine jsonb; published_row jsonb; can_board boolean; manager boolean;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'Location access required.' USING errcode='42501';END IF;
 points_live:=leaderboard_private.live_dashboard(p_location_id,p_month);
 can_board:=public.app_access_allowed(p_location_id,'points','leaderboard') IS TRUE;
 manager:=public.mod_is_manager(p_location_id) IS TRUE;
 IF manager AND can_board THEN preview:=approved_scoring_private.combined_preview(p_location_id,p_month);END IF;
 IF can_board THEN SELECT to_jsonb(p) INTO published FROM leaderboard_private.publications p
  WHERE p.location_id=p_location_id AND p.month=date_trunc('month',p_month)::date
  ORDER BY p.week_start DESC,p.revision DESC,p.published_at DESC,p.id DESC LIMIT 1;END IF;
 SELECT s INTO mine FROM jsonb_array_elements(points_live->'standings') s WHERE s->>'user_id'=auth.uid()::text;
 SELECT s INTO published_row FROM jsonb_array_elements(coalesce(published->'standings','[]'::jsonb)) s WHERE s->>'user_id'=auth.uid()::text;
 RETURN jsonb_build_object(
  'standings',CASE WHEN NOT can_board THEN '[]'::jsonb WHEN manager THEN preview ELSE coalesce(published->'standings','[]'::jsonb) END,
  'mine',CASE WHEN mine IS NULL THEN NULL ELSE (mine-'rank')||jsonb_build_object(
   'rank',published_row->'rank','combined_score',published_row->'combined_score','eligible',published_row->'eligible') END,
  'history',coalesce(points_live->'history','[]'::jsonb),'published',published,
  'rank_formula',jsonb_build_object('points',50,'sales',25,'performance',25));
END;$dashboard$;

CREATE OR REPLACE FUNCTION public.publish_weekly_points_leaderboard(
 p_location_id uuid,p_month date,p_week_start date,p_expected_publication uuid,p_expected_standings jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $publish$
DECLARE latest uuid;replaced uuid;next_revision integer;live jsonb;result jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE OR public.mod_is_manager(p_location_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'Management access required.' USING errcode='42501';END IF;
 PERFORM public.app_access_assert(p_location_id,'points','leaderboard');
 IF p_month IS NULL THEN RAISE EXCEPTION 'Select a month.';END IF;
 IF p_week_start IS NULL OR extract(isodow FROM p_week_start)<>1 THEN RAISE EXCEPTION 'Choose the Monday that starts the publication week.';END IF;
 IF p_week_start<date_trunc('month',p_month)::date-6 OR p_week_start>=date_trunc('month',p_month)::date+interval '1 month' THEN
  RAISE EXCEPTION 'The publication week must overlap the selected points month.';END IF;
 IF jsonb_typeof(p_expected_standings) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Refresh the standings before publishing.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('leaderboard:'||p_location_id::text||':'||p_week_start::text,0));
 SELECT id INTO latest FROM leaderboard_private.publications WHERE location_id=p_location_id AND month=date_trunc('month',p_month)::date
  ORDER BY week_start DESC,revision DESC,published_at DESC,id DESC LIMIT 1;
 IF latest IS DISTINCT FROM p_expected_publication THEN RAISE EXCEPTION 'A newer leaderboard was published. Refresh before publishing.';END IF;
 SELECT id,revision+1 INTO replaced,next_revision FROM leaderboard_private.publications
  WHERE location_id=p_location_id AND week_start=p_week_start ORDER BY revision DESC,published_at DESC,id DESC LIMIT 1;
 next_revision:=coalesce(next_revision,1);
 live:=approved_scoring_private.combined_preview(p_location_id,p_month);
 IF live IS DISTINCT FROM p_expected_standings THEN RAISE EXCEPTION 'Points, sales or performance changed since this preview. Refresh and review before publishing.';END IF;
 INSERT INTO leaderboard_private.publications(location_id,month,week_start,revision,replaces_id,standings,published_by)
 VALUES(p_location_id,date_trunc('month',p_month)::date,p_week_start,next_revision,replaced,live,auth.uid())
 RETURNING to_jsonb(publications) INTO result;
 RETURN result;
END;$publish$;

-- Decision 3: new game rounds remain pending until Management verifies them.
ALTER TABLE public.restaurant_game_rounds ADD COLUMN IF NOT EXISTS verification_status text;
ALTER TABLE public.restaurant_game_rounds ADD COLUMN IF NOT EXISTS verified_by uuid;
ALTER TABLE public.restaurant_game_rounds ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.restaurant_game_rounds ADD COLUMN IF NOT EXISTS verification_note text;
UPDATE public.restaurant_game_rounds SET verification_status='legacy_unverified' WHERE verification_status IS NULL;
ALTER TABLE public.restaurant_game_rounds ALTER COLUMN verification_status SET DEFAULT 'pending';
ALTER TABLE public.restaurant_game_rounds ALTER COLUMN verification_status SET NOT NULL;
DO $game_check$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.restaurant_game_rounds'::regclass AND conname='restaurant_game_verification_status') THEN
 ALTER TABLE public.restaurant_game_rounds ADD CONSTRAINT restaurant_game_verification_status CHECK(verification_status IN('pending','verified','rejected','legacy_unverified'));END IF;END;$game_check$;

CREATE OR REPLACE FUNCTION public.restaurant_game_round_submit(
 p_location_id uuid,p_request_id uuid,p_game_id text,p_correct integer,p_total integer,p_source text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $game_submit$
DECLARE day date:=((now() AT TIME ZONE 'America/Chicago')-interval '4 hours')::date;prior public.restaurant_game_rounds%rowtype;saved public.restaurant_game_rounds%rowtype;section text;
BEGIN
 IF auth.uid() IS NULL OR public.closeout_is_member(p_location_id) IS NOT TRUE THEN RAISE EXCEPTION 'Active employee access required.' USING errcode='42501';END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A round request ID is required.';END IF;
 IF p_game_id NOT IN('order','table','sell','spot','rush','match','detective','switch','floor','script') THEN RAISE EXCEPTION 'Choose a valid restaurant game.';END IF;
 IF p_total IS NULL OR p_total NOT BETWEEN 1 AND 25 OR p_correct IS NULL OR p_correct<0 OR p_correct>p_total THEN RAISE EXCEPTION 'The completed score is invalid.';END IF;
 IF p_source NOT IN('daily_challenge','games_page') THEN RAISE EXCEPTION 'The game source is invalid.';END IF;
 section:=CASE WHEN p_game_id IN('order','match','switch') THEN 'food' WHEN p_game_id='floor' THEN 'sections' ELSE 'service' END;
 PERFORM public.app_access_assert(p_location_id,CASE WHEN p_game_id='floor' THEN 'floor' ELSE 'training' END,section);
 SELECT * INTO prior FROM public.restaurant_game_rounds WHERE location_id=p_location_id AND user_id=auth.uid() AND request_id=p_request_id;
 IF prior.id IS NOT NULL THEN
  IF prior.game_id<>p_game_id OR prior.correct_count<>p_correct OR prior.total<>p_total OR prior.source<>p_source THEN RAISE EXCEPTION 'This round request was already used with different results.';END IF;
  RETURN jsonb_build_object('saved',true,'id',prior.id,'awards','[]'::jsonb,'already_saved',true,'verification_status',prior.verification_status);
 END IF;
 INSERT INTO public.restaurant_game_rounds(location_id,user_id,request_id,business_date,game_id,source,correct_count,total,score,verification_status)
 VALUES(p_location_id,auth.uid(),p_request_id,day,p_game_id,p_source,p_correct,p_total,p_correct*10,'pending') RETURNING * INTO saved;
 RETURN jsonb_build_object('saved',true,'id',saved.id,'awards','[]'::jsonb,'already_saved',false,'verification_status','pending');
END;$game_submit$;

CREATE OR REPLACE FUNCTION public.restaurant_game_round_verify(
 p_location_id uuid,p_round_id uuid,p_expected_status text,p_approve boolean,p_note text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $verify$
DECLARE r public.restaurant_game_rounds%rowtype;week date;practice_days integer;qualifying_rounds integer;practiced_games integer;earned jsonb:='[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.mod_is_manager(p_location_id) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required.' USING errcode='42501';END IF;
 IF p_approve IS NULL OR length(coalesce(p_note,''))>1000 THEN RAISE EXCEPTION 'Enter a valid verification decision.';END IF;
 SELECT * INTO r FROM public.restaurant_game_rounds WHERE id=p_round_id AND location_id=p_location_id FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Game round not found.';END IF;
 IF r.verification_status IS DISTINCT FROM p_expected_status OR r.verification_status<>'pending' THEN RAISE EXCEPTION 'This round was already reviewed. Refresh results.';END IF;
 UPDATE public.restaurant_game_rounds SET verification_status=CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END,
  verified_by=auth.uid(),verified_at=clock_timestamp(),verification_note=nullif(btrim(coalesce(p_note,'')),'') WHERE id=r.id;
 IF p_approve THEN
  week:=r.business_date-(extract(isodow FROM r.business_date)::integer-1);
  PERFORM pg_advisory_xact_lock(hashtextextended('game-week:'||p_location_id::text||':'||r.user_id::text||':'||week::text,0));
  SELECT count(DISTINCT business_date),count(*),count(DISTINCT game_id) INTO practice_days,qualifying_rounds,practiced_games
  FROM(SELECT business_date,game_id FROM public.restaurant_game_rounds WHERE location_id=p_location_id AND user_id=r.user_id
   AND business_date BETWEEN week AND week+6 AND verification_status='verified' GROUP BY business_date,game_id) q;
  IF practice_days>=3 THEN INSERT INTO public.restaurant_game_weekly_awards(location_id,user_id,week_start,milestone,points)
   VALUES(p_location_id,r.user_id,week,'THREE_DAYS',5) ON CONFLICT DO NOTHING;
   IF found THEN earned:=earned||jsonb_build_array(jsonb_build_object('milestone','THREE_DAYS','points',5));END IF;END IF;
  IF qualifying_rounds>=10 AND practiced_games>=3 THEN INSERT INTO public.restaurant_game_weekly_awards(location_id,user_id,week_start,milestone,points)
   VALUES(p_location_id,r.user_id,week,'TEN_ROUNDS_THREE_GAMES',5) ON CONFLICT DO NOTHING;
   IF found THEN earned:=earned||jsonb_build_array(jsonb_build_object('milestone','TEN_ROUNDS_THREE_GAMES','points',5));END IF;END IF;
 END IF;
 RETURN jsonb_build_object('saved',true,'verification_status',CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END,'awards',earned);
END;$verify$;

DO $results_wrap$ BEGIN
 IF to_regprocedure('approved_scoring_private.game_results_before_verification(uuid,uuid,date,date)') IS NULL THEN
  ALTER FUNCTION public.restaurant_game_results_load(uuid,uuid,date,date) SET SCHEMA approved_scoring_private;
  ALTER FUNCTION approved_scoring_private.restaurant_game_results_load(uuid,uuid,date,date) RENAME TO game_results_before_verification;
 END IF;
END;$results_wrap$;
CREATE OR REPLACE FUNCTION public.restaurant_game_results_load(p_location_id uuid,p_user_id uuid DEFAULT NULL,p_from date DEFAULT NULL,p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $results$
DECLARE payload jsonb;items jsonb;
BEGIN
 payload:=approved_scoring_private.game_results_before_verification(p_location_id,p_user_id,p_from,p_to);
 SELECT coalesce(jsonb_agg(row||jsonb_build_object('verification_status',r.verification_status,'verified_by',r.verified_by,
  'verified_at',r.verified_at,'verification_note',r.verification_note) ORDER BY n),'[]'::jsonb) INTO items
 FROM jsonb_array_elements(coalesce(payload->'rows','[]'::jsonb)) WITH ORDINALITY x(row,n)
 JOIN public.restaurant_game_rounds r ON r.id=(row->>'id')::uuid;
 RETURN payload||jsonb_build_object('rows',items,'pending_count',(SELECT count(*) FROM public.restaurant_game_rounds r
  WHERE r.location_id=p_location_id AND r.verification_status='pending' AND (p_user_id IS NULL OR r.user_id=p_user_id)));
END;$results$;

REVOKE ALL ON FUNCTION public.quiz_manager_save_v2(uuid,uuid,date,text,text,jsonb,boolean,integer,boolean),
 public.restaurant_game_round_submit(uuid,uuid,text,integer,integer,text),public.restaurant_game_round_verify(uuid,uuid,text,boolean,text),
 public.restaurant_game_results_load(uuid,uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_manager_save_v2(uuid,uuid,date,text,text,jsonb,boolean,integer,boolean),
 public.restaurant_game_round_submit(uuid,uuid,text,integer,integer,text),public.restaurant_game_round_verify(uuid,uuid,text,boolean,text),
 public.restaurant_game_results_load(uuid,uuid,date,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT true AS approved_policies_sql_completed,false AS production_behavior_verified;
