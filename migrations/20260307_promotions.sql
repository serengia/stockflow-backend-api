-- Promotions table (per business) for POS promo codes
CREATE TABLE IF NOT EXISTS promotions (
  id serial PRIMARY KEY,
  business_id integer NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  type varchar(50) NOT NULL DEFAULT 'percent_off',
  config text,
  valid_from varchar(50) NOT NULL,
  valid_to varchar(50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
