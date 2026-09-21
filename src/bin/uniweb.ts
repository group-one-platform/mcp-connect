#!/usr/bin/env node
/** Published as `uniweb-connect`: the brand is pinned, `--brand` still overrides. */
import { main } from '../cli.js';

main({ defaultBrandId: 'uniweb', commandName: 'uniweb-connect' });
