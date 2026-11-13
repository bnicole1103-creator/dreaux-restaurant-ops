# Reservation flow integration

This change adds party-size minus/plus controls across booking, editing, seating and availability forms; optional floor-map selection; and saved physical seat-count increases with authorization, stale-count checks and an audit record. A selected table plan is passed through capacity validation. Automatic suggestions remain available when no tables are selected.

The newer Reservations page, selected-guest contact card, inquiry-to-confirmation callback and seated-reservation status sync remain intact. Inquiry detail times and booking review prompts display AM/PM. The timeline extends to the final dining/reset period and includes arrival pacing counts.

Apply the full `supabase/migrations/20261112_table_seat_correction.sql` in Supabase before using Save seats. This migration is idempotent. It does not change existing table counts on installation. Quick correction only increases counts after staff confirm the actual chairs fit; reductions remain in the layout editor.

Validation: TypeScript/production build; isolated database checks for permission denial, stale seat counts, reduction protection, successful increase, auditing and repeated migration application. Live database and seating interactions were not tested from this checkout.

This integration does not install the separate 4:00 AM cleanup scheduler or the sales-target queue preview fix. Existing availability and overlap guards remain in force; committing this UI update does not establish that every legacy reservation conflict is resolved.
