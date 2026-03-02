// agent types and interfaces definitions

type AgentType = 'human' | 'bot';

type AgentStatus = 'active' | 'inactive';

interface Agent {
    id: string;
    name: string;
    type: AgentType;
    status: AgentStatus;
}

interface BotAgent extends Agent {
    botSpecificProperty: string;
}

interface HumanAgent extends Agent {
    humanSpecificProperty: number;
}
