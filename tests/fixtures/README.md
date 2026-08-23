# QuantStudio test fixture

`quantstudio-32well-deidentified.xlsx` is the portable default fixture for
`template.integration.test.js`. It retains the worksheet shape, Ct values,
targets, generic sample labels, and 32-well layout required for regression
testing.

The fixture replaces the experiment file path, experiment name and dates,
instrument name and serial number, and user name with synthetic values. Do not
replace it with an unsanitized laboratory export.

To regenerate it from an authorized source workbook:

```bash
npm run fixture:create -- /absolute/path/to/source.xls
```

To replay an external real template without changing the repository fixture:

```bash
CNV_TEMPLATE_XLS=/absolute/path/to/template.xls npm run test:integration
```

