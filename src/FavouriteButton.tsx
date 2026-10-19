import { Star } from 'lucide-react';

export function FavouriteButton({ favourite, disabled, onClick, label }: {
  favourite: boolean; disabled?: boolean; onClick: () => void; label: string;
}) {
  const action = `${favourite ? 'Remove from' : 'Add to'} favourites: ${label}`;
  return <button type="button" className="favourite-button" aria-label={action} title={action}
    aria-pressed={favourite} disabled={disabled} onClick={onClick}>
    <Star size={21} fill={favourite ? 'currentColor' : 'none'} aria-hidden="true" />
  </button>;
}
