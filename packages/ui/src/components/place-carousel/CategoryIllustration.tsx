import {
  Boat,
  CastleTurret,
  Champagne,
  Coffee,
  ForkKnife,
  type Icon,
  Sailboat,
  ShoppingBag,
  Tree,
  UmbrellaSimple,
} from '@phosphor-icons/react';
import type { PlaceCardPayload } from '../../payloads';

const ICONS: Record<PlaceCardPayload['category'], Icon> = {
  beach: UmbrellaSimple,
  restaurant: ForkKnife,
  cafe_bar: Coffee,
  sight: CastleTurret,
  nature: Tree,
  activity: Sailboat,
  shop: ShoppingBag,
  nightlife: Champagne,
  day_trip: Boat,
};

/**
 * Stands in for a place without a photo: one duotone icon per category on a sea-blue tile.
 * Real illustrations replace it here, in this one component.
 */
export function CategoryIllustration({ category }: { category: PlaceCardPayload['category'] }) {
  const Glyph = ICONS[category];
  return (
    <span className="fv-illustration" aria-hidden="true">
      <Glyph weight="duotone" />
    </span>
  );
}
