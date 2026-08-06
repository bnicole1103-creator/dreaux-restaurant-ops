JusTini's Stripped-Down Supabase Cloud App

SETUP
1. In Supabase SQL Editor, paste and run setup.sql.
2. In Authentication > Providers, keep Email enabled.
3. For fastest testing, Authentication > Providers > Email:
   temporarily disable Confirm email. Re-enable later if desired.
4. Open config.js and paste:
   - Project URL
   - Publishable key (NOT secret/service-role key)
5. Upload index.html and config.js together to Netlify Drop.
6. Every employee opens the same link and creates an account.

WHAT SYNCS
- Shared visual floor
- Assignments
- Seating
- Table statuses
- Cash drawer opening entries
- Cash deposits
- Void/comp receipt records and receipt photos
- Manager cashouts
- Activity log

TEMPORARY SECURITY
The SQL uses broad authenticated-user policies for one restaurant so this can launch quickly.
Any signed-in employee can currently see and change operational records.
Tighten permissions by role before treating it as a permanent production system.

IMPORTANT
Never put a Supabase secret key or service-role key in config.js.
Use only the publishable key.
