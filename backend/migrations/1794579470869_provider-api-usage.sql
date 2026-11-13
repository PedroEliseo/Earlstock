-- Up Migration

-- Daily API call usage per external market data provider, persisted so a restart cannot reset it.
-- usage_date is the provider's billing day (EODHD resets at midnight GMT, so it is a UTC date).
-- calls_used counts billed API calls (endpoint cost), not HTTP requests.
CREATE TABLE provider_api_usage (
  provider   VARCHAR(32) NOT NULL,
  usage_date DATE        NOT NULL,
  calls_used INTEGER     NOT NULL CHECK (calls_used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, usage_date)
);

-- Down Migration

DROP TABLE provider_api_usage;
