#!/usr/bin/env node
import { createCLI } from "../cli/cli.js";

const program = createCLI();
program.parse();
