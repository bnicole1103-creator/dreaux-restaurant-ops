begin;
do $$
begin
 if to_regprocedure('public.app_decals_before_stickers(jsonb)') is null then
  alter function public.app_decals_valid(jsonb)
   rename to app_decals_before_stickers;
 end if;
end;
$$;

create or replace function public.app_decals_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare choice text := p->>'decal';
begin
 if jsonb_typeof(p) is distinct from 'object' then return false; end if;
 if choice like 'sticker-%' then
  if choice not in (
   'sticker-pumpkin','sticker-ghost','sticker-bat','sticker-web','sticker-candy',
   'sticker-maple','sticker-leaves','sticker-sunflower','sticker-pie',
   'sticker-tree','sticker-snow','sticker-snowman','sticker-gift','sticker-bow',
   'sticker-heart','sticker-rose','sticker-kiss','sticker-hearts',
   'sticker-mask','sticker-crown','sticker-fleur','sticker-confetti',
   'sticker-flower','sticker-tulip','sticker-butterfly','sticker-rainbow',
   'sticker-sun','sticker-lemon','sticker-palm','sticker-watermelon',
   'sticker-sparkle','sticker-cocktail','sticker-cheers','sticker-star',
   'sticker-music','sticker-party'
  ) then return false; end if;
  return public.app_decals_before_stickers(jsonb_set(p,'{decal}','"none"'::jsonb));
 end if;
 return public.app_decals_before_stickers(p);
end;
$$;
revoke all on function public.app_decals_before_stickers(jsonb),
 public.app_decals_valid(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
