#!/usr/bin/env node
/** Published as `dogado-connect`: the brand is pinned, `--brand` still overrides. */
import { main } from '../cli.js';

main({ defaultBrandId: 'dogado', commandName: 'dogado-connect' });
