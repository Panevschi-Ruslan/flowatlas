import { addTour } from '../lib/registries';
import { TourLate } from './screens';

// Reached only through a dynamic import: when it adds is not known.
addTour({ Screen: TourLate });
