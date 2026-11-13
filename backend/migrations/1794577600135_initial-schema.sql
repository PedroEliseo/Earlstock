-- Up Migration

CREATE TABLE stocks (
  id         UUID         PRIMARY KEY,
  symbol     VARCHAR(16)  NOT NULL,
  name       VARCHAR(255) NOT NULL,
  exchange   VARCHAR(32)  NOT NULL,
  currency   CHAR(3)      NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT stocks_exchange_symbol_key UNIQUE (exchange, symbol)
);

CREATE TABLE price_quotes (
  id          BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stock_id    UUID          NOT NULL REFERENCES stocks (id),
  price       NUMERIC(20,8) NOT NULL,
  volume      NUMERIC(24,8),
  observed_at TIMESTAMPTZ   NOT NULL,
  provider    VARCHAR(32)   NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT price_quotes_stock_observed_provider_key UNIQUE (stock_id, observed_at, provider)
);

CREATE INDEX price_quotes_stock_id_observed_at_idx ON price_quotes (stock_id, observed_at DESC);

-- Down Migration

DROP TABLE price_quotes;
DROP TABLE stocks;
