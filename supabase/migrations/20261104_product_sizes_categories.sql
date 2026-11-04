BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE ops_reporting_private.products ADD COLUMN IF NOT EXISTS spirit_category text NOT NULL DEFAULT '';
CREATE OR REPLACE FUNCTION public.operations_product_save(p_location_id uuid,p_key text,p_version integer,p_values jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior ops_reporting_private.products;saved ops_reporting_private.products;item jsonb;price record;tbl text;valid boolean;
BEGIN
 PERFORM ops_reporting_private.assert_access(p_location_id);
 IF coalesce(p_values->>'spirit_category','') NOT IN ('','Vodka','Tequila','Mezcal','Rum','Gin','Whiskey / Bourbon','Scotch','Cognac','Brandy','Liqueur / Cordial','Wine','Sparkling wine','Beer / Cider','Non-alcoholic','Other') THEN RAISE EXCEPTION 'Choose a valid product category.'; END IF;
 IF p_key IS NULL OR length(p_key)>220 OR p_key!~'^(bottle:.+|ingredient:[0-9a-f-]{36})$' OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Choose a valid product.';END IF;
 IF length(btrim(coalesce(p_values->>'name',''))) NOT BETWEEN 1 AND 240 OR length(coalesce(p_values->>'vendor',''))>200 OR length(coalesce(p_values->>'notes',''))>5000 OR jsonb_typeof(p_values->'prices') IS DISTINCT FROM 'object' OR jsonb_typeof(p_values->'recipes') IS DISTINCT FROM 'array' OR jsonb_typeof(p_values->'receipts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_values->'recipes')>100 OR jsonb_array_length(p_values->'receipts')>50 THEN RAISE EXCEPTION 'Review product details and attachments.';END IF;
 FOR price IN SELECT * FROM jsonb_each_text(p_values->'prices') LOOP
  IF length(price.key)>40 OR price.value !~ '^[0-9]+(\.[0-9]{1,2})?$' OR price.value::numeric>1000000 THEN RAISE EXCEPTION 'Prices must be positive USD amounts with up to two decimals.';END IF;
 END LOOP;
 p_values:=jsonb_set(p_values,'{prices}',coalesce((SELECT jsonb_object_agg(ops_reporting_private.size_label(key),value) FROM jsonb_each(p_values->'prices')),'{}'::jsonb));
 FOR item IN SELECT value FROM jsonb_array_elements(p_values->'recipes') LOOP
  tbl:=CASE item->>'kind' WHEN 'food' THEN 'public.training_food' WHEN 'cocktails' THEN 'public.training_cocktails' ELSE NULL END;
  IF tbl IS NULL OR to_regclass(tbl) IS NULL THEN RAISE EXCEPTION 'Choose an installed recipe.';END IF;
  EXECUTE 'select exists(select 1 from '||tbl||' where location_id=$1 and id=$2)' INTO valid USING p_location_id,(item->>'id')::uuid;
  IF NOT valid THEN RAISE EXCEPTION 'Recipe is not available at this location.';END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_values->'receipts') LOOP
  IF item->>'type'='receipt' THEN
   EXECUTE 'select exists(select 1 from public.closeout_receipts where location_id=$1 and id=$2 and deleted_at is null and (added_at is not null or coalesce(legacy_linked,false)))' INTO valid USING p_location_id,(item->>'id')::uuid;
  ELSIF item->>'type'='file' THEN
   SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='product-documents' AND name=item->>'path' AND split_part(name,'/',1)=p_location_id::text) INTO valid;
  ELSE valid:=false;END IF;
  IF NOT valid THEN RAISE EXCEPTION 'Choose an attached receipt or upload a product document at this location.';END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('product:'||p_location_id::text||p_key,0));
 SELECT * INTO prior FROM ops_reporting_private.products WHERE location_id=p_location_id AND product_key=p_key FOR UPDATE;
 IF coalesce(prior.version,0) IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Product changed. Reopen before saving.';END IF;
 INSERT INTO ops_reporting_private.products(location_id,product_key,name,vendor,prices,recipes,receipts,notes,spirit_category,updated_by)
 VALUES(p_location_id,p_key,btrim(p_values->>'name'),btrim(coalesce(p_values->>'vendor','')),p_values->'prices',p_values->'recipes',p_values->'receipts',coalesce(p_values->>'notes',''),coalesce(p_values->>'spirit_category',prior.spirit_category,''),auth.uid())
 ON CONFLICT(location_id,product_key) DO UPDATE SET name=excluded.name,vendor=excluded.vendor,prices=excluded.prices,recipes=excluded.recipes,receipts=excluded.receipts,notes=excluded.notes,spirit_category=excluded.spirit_category,version=products.version+1,updated_at=clock_timestamp(),updated_by=auth.uid() RETURNING * INTO saved;
 INSERT INTO ops_reporting_private.product_audit(location_id,product_key,actor,before_record,after_record) VALUES(p_location_id,p_key,auth.uid(),CASE WHEN prior.version IS NULL THEN NULL ELSE to_jsonb(prior) END,to_jsonb(saved));
 RETURN to_jsonb(saved);
END;$$;


CREATE OR REPLACE FUNCTION public.operations_product_categories(p_location_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM ops_reporting_private.assert_access(p_location_id);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('product_key',product_key,'category',spirit_category)) FROM ops_reporting_private.products WHERE location_id=p_location_id),'[]'::jsonb);
END;$$;
REVOKE ALL ON FUNCTION public.operations_product_categories(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operations_product_categories(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
