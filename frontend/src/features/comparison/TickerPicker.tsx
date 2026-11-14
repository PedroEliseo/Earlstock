import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import { useMemo, useState } from 'react';
import { StockName } from '../../components/StockName';
import { MAX_TICKERS, MIN_TICKERS } from './compareViewState';
import { useTickerSearch } from './useTickerSearch';

interface TickerPickerProps {
  selected: readonly string[];
  onChange: (tickers: string[]) => void;
}

/**
 * Selection of 2–5 tickers. Suggestions come from the API's ticker search as the user types (the
 * API filters, so the component does not filter again). Duplicates are impossible (selected tickers
 * are not suggested) and further options are disabled once five are selected. A ticker that is not
 * in the dataset (e.g. from a shared link) is reported by the comparison itself, with a way to
 * remove it.
 */
export function TickerPicker({ selected, onChange }: TickerPickerProps) {
  const [input, setInput] = useState('');
  // Autocomplete resets the typed text whenever `value` changes identity, so it must only change
  // when the selection does (the parent re-derives `selected` from the URL on every render).
  const selectedKey = selected.join(',');
  const value = useMemo(() => (selectedKey ? selectedKey.split(',') : []), [selectedKey]);
  const search = useTickerSearch(input);
  const found = search.data?.data.data ?? [];
  const suggestions = found.map((stock) => stock.ticker);
  // Names of the suggested stocks, shown next to each ticker in the list.
  const nameOf = new Map(found.map((stock) => [stock.ticker, stock.name] as const));
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
      // Selected values must be among the options for MUI; the API suggestions are added after.
      options={[...new Set([...value, ...suggestions])]}
      value={value}
      inputValue={input}
      onInputChange={(_event, value) => {
        setInput(value);
      }}
      loading={search.isFetching}
      loadingText="Searching…"
      noOptionsText={search.isError ? 'Could not search tickers' : 'No matching tickers'}
      filterOptions={(options) => options}
      filterSelectedOptions
      getOptionDisabled={() => full}
      onChange={(_event, value) => {
        onChange(value.slice(0, MAX_TICKERS));
      }}
      renderOption={(props, ticker) => {
        const { key, ...optionProps } = props;
        const name = nameOf.get(ticker);
        return (
          <Box
            component="li"
            key={key}
            {...optionProps}
            sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}
          >
            <Box component="span" sx={{ fontWeight: 600, minWidth: '4.5em' }}>
              {ticker}
            </Box>
            {name !== undefined && (
              <StockName name={name} variant="body2" component="span" color="text.secondary" />
            )}
          </Box>
        );
      }}
      renderValue={(value, getItemProps) =>
        value.map((ticker, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return <Chip key={key} {...itemProps} label={ticker} size="small" />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label="Stocks to compare"
          placeholder={full ? undefined : 'Search by name or ticker'}
          helperText={helper}
        />
      )}
      sx={{ maxWidth: 720 }}
    />
  );
}
