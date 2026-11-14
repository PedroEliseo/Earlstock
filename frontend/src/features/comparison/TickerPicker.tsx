import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import { MAX_TICKERS, MIN_TICKERS } from './compareViewState';

interface TickerPickerProps {
  /** Tickers of the active dataset (from the stock list), or undefined while loading. */
  available: readonly string[] | undefined;
  loading: boolean;
  selected: readonly string[];
  onChange: (tickers: string[]) => void;
}

// Case-insensitive substring search; at most 100 suggestions are rendered at a time.
const filterOptions = createFilterOptions<string>({
  ignoreCase: true,
  matchFrom: 'any',
  limit: 100,
});

/**
 * Selection of 2–5 tickers from the stock list (no per-stock requests). Duplicates are impossible
 * (options are unique) and further options are disabled once five are selected. Selected tickers
 * that are not in the dataset (e.g. from a shared link) stay visible, marked as unknown.
 */
export function TickerPicker({ available, loading, selected, onChange }: TickerPickerProps) {
  const known = new Set(available ?? []);
  const options = [...new Set([...(available ?? []), ...selected])];
  const full = selected.length >= MAX_TICKERS;
  const helper =
    selected.length < MIN_TICKERS
      ? `Select at least ${String(MIN_TICKERS)} stocks (up to ${String(MAX_TICKERS)}).`
      : full
        ? `Maximum of ${String(MAX_TICKERS)} stocks selected. Remove one to add another.`
        : `${String(selected.length)} of ${String(MAX_TICKERS)} stocks selected.`;

  return (
    <Autocomplete
      multiple
      options={options}
      value={[...selected]}
      loading={loading}
      filterOptions={filterOptions}
      filterSelectedOptions
      getOptionDisabled={() => full}
      onChange={(_event, value) => {
        onChange(value.slice(0, MAX_TICKERS));
      }}
      renderValue={(value, getItemProps) =>
        value.map((ticker, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          const unknown = available !== undefined && !known.has(ticker);
          return (
            <Chip
              key={key}
              {...itemProps}
              label={unknown ? `${ticker} (not in dataset)` : ticker}
              color={unknown ? 'error' : 'default'}
              variant={unknown ? 'outlined' : 'filled'}
              size="small"
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label="Stocks to compare"
          placeholder={full ? undefined : 'Search tickers'}
          helperText={helper}
        />
      )}
      sx={{ maxWidth: 720 }}
    />
  );
}
