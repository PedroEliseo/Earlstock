import { Link } from 'react-router';
import { StatusMessage } from './StatusMessage';
import { usePageTitle } from './usePageTitle';

export function NotFoundPage({
  title = 'Page not found',
  description,
}: {
  title?: string;
  description?: string;
}) {
  usePageTitle(title);
  return (
    <>
      <h1>{title}</h1>
      <StatusMessage
        kind="info"
        title={title}
        description={description ?? 'There is nothing at this address.'}
        action={<Link to="/">Go to the explorer</Link>}
      />
    </>
  );
}
