// Profile's module is evaluated before this one's own statements: its step comes first.
import './profile';
import { steps } from '../lib/registries';
import { Intro } from './screens';

steps.add({ Screen: Intro });
