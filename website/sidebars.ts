import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: 'Introduction',
    },
    {
      type: 'doc',
      id: 'getting-started',
      label: 'Getting Started',
    },
    {
      type: 'doc',
      id: 'workflow-files',
      label: 'Workflow Files',
    },
    {
      type: 'category',
      label: 'Step Types',
      items: [
        'steps/overview',
        'steps/run-uses',
        'steps/agent',
        'steps/input',
        'steps/parallel',
        'steps/loop',
        'steps/foreach',
        'steps/widget',
        'steps/plugin-step',
      ],
    },
    {
      type: 'doc',
      id: 'agents-providers',
      label: 'Agents & Providers',
    },
    {
      type: 'doc',
      id: 'structured-output',
      label: 'Structured Output',
    },
    {
      type: 'doc',
      id: 'resume-journaling',
      label: 'Resume & Journaling',
    },
    {
      type: 'doc',
      id: 'cli-reference',
      label: 'CLI Reference',
    },
    {
      type: 'doc',
      id: 'programmatic-usage',
      label: 'Programmatic Usage',
    },
    {
      type: 'category',
      label: 'Extensibility',
      items: [
        'extensibility/widgets',
        'extensibility/plugins',
        'extensibility/workflow-dependencies',
      ],
    },
    {
      type: 'doc',
      id: 'example-mission',
      label: 'Example: Mission Workflow',
    },
    {
      type: 'doc',
      id: 'troubleshooting',
      label: 'Troubleshooting & FAQ',
    },
    {
      type: 'doc',
      id: 'contributing',
      label: 'Contributing',
    },
  ],
};

export default sidebars;
