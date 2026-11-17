import { WidgetRegistry } from '../lib/widgets';
import { Clock } from './screens';

// Added to the class's static field outside the class and outside any function.
WidgetRegistry.items.push({ path: '/clock', Screen: Clock });
