import { addPanel } from '../lib/panels';
import { PluginRegistry } from '../lib/plugins';
import { addReport } from '../lib/reports';
import { addTool } from '../lib/tools';
import { Calendar, Exporter, Sales, Usage } from './screens';

addPanel({ path: '/usage', Screen: Usage });
addReport({ id: 'sales', path: '/reports/sales', Screen: Sales });
addTool({ name: 'Export', path: '/export', Screen: Exporter });
PluginRegistry.add({ path: '/calendar', Screen: Calendar });
