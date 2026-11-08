# PRD — Plataforma de Inteligência Tributária com IA

## Prompt para geração do protótipo

Crie um protótipo funcional de uma **plataforma online de inteligência tributária e financeira**, voltada para pessoas e organizações que precisam entender, organizar, calcular, acompanhar e otimizar questões relacionadas a impostos e obrigações.

O produto deve funcionar como um **ecossistema tributário pessoal**, no qual a IA é a principal interface de interação.

A plataforma não deve parecer um software contábil tradicional.

O usuário deve conseguir conversar com a IA para:

- entender sua situação tributária;
- fazer perguntas;
- analisar documentos;
- descobrir possíveis oportunidades legais de economia;
- criar dashboards;
- modificar dashboards;
- criar diferentes agentes/IA;
- organizar informações;
- criar alertas;
- simular cenários;
- acompanhar obrigações;
- gerar relatórios;
- evoluir o próprio sistema conforme o utiliza.

Princípio central:

> **O usuário não precisa aprender a usar o sistema. O sistema aprende como o usuário quer trabalhar.**

---

# 1. Visão do produto

A plataforma deve atender diferentes contextos:

- empresas;
- empresários;
- prestadores de serviço;
- profissionais autônomos;
- pessoas físicas;
- investidores;
- proprietários de patrimônio;
- inventariantes;
- famílias;
- outros usuários que precisem lidar com impostos, patrimônio e obrigações.

O produto começa simples e se torna mais completo conforme o usuário conversa e fornece informações.

A IA não deve ser apenas um chatbot colocado ao lado do sistema.

**A conversa deve ser uma forma de controlar, configurar e evoluir o próprio sistema.**

Exemplo:

Usuário:

> "Quero saber quanto estou pagando de imposto na minha empresa."

IA:

> "Claro. Vou criar um painel para acompanhar sua carga tributária. Primeiro preciso conhecer alguns dados da empresa."

Depois do diagnóstico, a IA cria o dashboard.

Usuário:

> "Agora coloca quanto paguei nos últimos 12 meses."

IA adiciona o gráfico.

Usuário:

> "Também quero saber quanto vou pagar no próximo mês."

IA adiciona uma previsão.

Usuário:

> "Se passar de R$ 20 mil, me avise."

IA cria um alerta.

O sistema deve evoluir dessa maneira.

---

# 2. Conceito central

A plataforma deve unir:

```text
                    PLATAFORMA
                        │
          ┌─────────────┴─────────────┐
          │                           │
         IA                         DADOS
          │                           │
          ↓                           ↓
    Conversação                  Documentos
    Interpretação                Empresas
    Automação                    Pessoas
    Personalização               Patrimônio
          │                       Inventários
          │                           │
          └─────────────┬─────────────┘
                        ↓
                MOTOR TRIBUTÁRIO
                        │
            ┌───────────┼───────────┐
            ↓           ↓           ↓
         Cálculos      Regras    Oportunidades
            │           │           │
            └───────────┼───────────┘
                        ↓
                  RESULTADOS
                        │
             ┌──────────┼──────────┐
             ↓          ↓           ↓
         Dashboard   Alertas     Relatórios
```

A IA interpreta o pedido do usuário e utiliza ferramentas especializadas do sistema.

A IA **não deve inventar cálculos tributários**.

O cálculo deve ser realizado por um motor tributário estruturado, com regras, premissas, fontes e versões.

A IA deve explicar os resultados de maneira simples.

---

# 3. Proposta de valor

A plataforma deve responder perguntas como:

> "Quanto estou pagando de imposto?"

> "Por que estou pagando isso?"

> "Existe alguma forma legal de pagar menos?"

> "Quanto vou pagar no próximo mês?"

> "Estou deixando algum crédito tributário de aproveitar?"

> "Tenho algum imposto atrasado?"

> "Quais documentos preciso enviar?"

> "Tenho alguma obrigação chegando?"

> "O que mudou na minha situação tributária?"

> "Se meu faturamento aumentar, o que acontece?"

> "O que acontece se eu mudar de regime?"

> "Quanto meu inventário pode pagar de ITCMD?"

> "Quais impostos preciso considerar nesse patrimônio?"

> "Organize tudo isso para mim."

---

# 4. Princípio de simplicidade

O usuário não deve precisar conhecer termos técnicos para utilizar a plataforma.

Em vez de:

> "Informe o regime de apuração do PIS/COFINS."

Preferir:

> "Como sua empresa calcula atualmente o PIS e a COFINS?"

E oferecer opções e explicações.

Sempre que houver um termo técnico, permitir:

> "O que significa isso?"

A IA deve explicar em linguagem comum.

---

# 5. Tipos de usuários

## Empresa

Acompanhar:

- faturamento;
- impostos;
- regime tributário;
- folha;
- compras;
- vendas;
- créditos;
- benefícios fiscais;
- obrigações;
- documentos;
- oportunidades;
- projeções;
- cenários.

## Prestador de serviço

Acompanhar:

- receitas;
- ISS;
- IR;
- INSS;
- emissão de notas;
- despesas;
- obrigações;
- planejamento tributário.

## Pessoa física

Acompanhar:

- Imposto de Renda;
- rendimentos;
- investimentos;
- patrimônio;
- despesas;
- dependentes;
- documentos;
- restituição;
- declarações.

## Inventariante

Acompanhar:

- patrimônio;
- imóveis;
- veículos;
- investimentos;
- empresas;
- dívidas;
- herdeiros;
- ITCMD;
- documentos;
- prazos;
- obrigações;
- estimativas;
- inventário.

## Patrimônio

Organizar:

- imóveis;
- veículos;
- investimentos;
- participações societárias;
- bens;
- dívidas;
- rendimentos;
- custos;
- tributos relacionados.

---

# 6. Workspace do usuário

O usuário deve possuir um workspace personalizável.

Exemplo:

```text
Meu Workspace

├── 🏢 Minha Empresa
│   ├── Dashboard Tributário
│   ├── Impostos
│   ├── Oportunidades
│   └── Obrigações
│
├── 👤 Vida Pessoal
│   ├── Imposto de Renda
│   ├── Patrimônio
│   └── Investimentos
│
├── ⚖️ Inventário
│   ├── Patrimônio
│   ├── ITCMD
│   └── Documentos
│
├── 📄 Documentos
│
└── 🤖 Minhas IAs
    ├── IA Tributária
    ├── IA Financeira
    └── IA Patrimonial
```

O usuário deve poder criar, remover, reorganizar e renomear esses espaços através da IA.

---

# 7. IA como interface principal

A tela principal deve dar destaque à conversa.

```text
┌──────────────────────────────────────────────┐
│                                              │
│         O que você precisa resolver?         │
│                                              │
│  "Quero entender meus impostos..."           │
│                                              │
│                       🎙  ↑                  │
└──────────────────────────────────────────────┘
```

Abaixo:

```text
Seus espaços

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 🏢 Empresa   │  │ 👤 Pessoal   │  │ ⚖ Inventário │
│ R$ 42.800    │  │ IR 2026      │  │ ITCMD        │
└──────────────┘  └──────────────┘  └──────────────┘
```

A conversa deve ser capaz de alterar o sistema.

---

# 8. Comandos naturais

O usuário deve poder falar:

> "Crie um painel para minha empresa."

> "Mostre quanto estou pagando de imposto."

> "Coloca um gráfico dos últimos 12 meses."

> "Tira esse gráfico."

> "Deixa esse número maior."

> "Coloca isso no topo."

> "Quero uma visão mais simples."

> "Crie uma página para minha contadora."

> "Me avise se meus impostos passarem de R$ 20 mil."

> "Crie uma IA para cuidar do meu inventário."

> "Essa IA pode usar os documentos que já enviei?"

> "Quero acompanhar esse patrimônio."

> "Faça um relatório disso."

A IA deve transformar esses pedidos em ações reais no sistema.

---

# 9. Agentes / múltiplas IAs

O usuário deve conseguir criar várias IAs especializadas.

Cada agente deve possuir:

- nome;
- personalidade;
- objetivo;
- contexto;
- dados autorizados;
- documentos autorizados;
- ferramentas disponíveis;
- dashboards;
- memória;
- regras;
- permissões.

Exemplos:

### IA Tributária

> Analisa minha situação tributária e procura oportunidades.

### IA da Empresa

> Acompanha os impostos e obrigações da minha empresa.

### IA Patrimonial

> Acompanha meu patrimônio e seus impactos tributários.

### IA do Inventário

> Organiza meu inventário, documentos, impostos e prazos.

### IA Financeira

> Analisa minhas receitas, despesas e projeções.

---

# 10. Criação de uma nova IA

Permitir:

> **Criar IA**

A IA pergunta:

> "O que você quer que essa IA faça?"

Usuário:

> "Quero uma IA para acompanhar o inventário do meu pai."

O sistema cria:

```text
Nome:
IA do Inventário

Objetivo:
Acompanhar patrimônio, documentos,
impostos e obrigações do inventário.

Dados:
Inventário selecionado

Ferramentas:
Consultar patrimônio
Calcular estimativas
Analisar documentos
Criar alertas
Gerar relatórios
```

O usuário pode editar tudo através da conversa.

---

# 11. Dashboards generativos

Os dashboards devem ser tratados como **objetos vivos**.

O usuário pode criar e modificar dashboards pela conversa.

Exemplo:

> "Crie um dashboard tributário."

IA cria:

```text
Carga tributária
R$ 42.800/mês

12,4% do faturamento

Impostos
████████████████

Evolução
gráfico dos últimos 12 meses

Oportunidades
3 encontradas

Próximos vencimentos
4
```

Depois:

> "Adicione previsão."

A IA adiciona.

> "Mostra também minha folha."

A IA adiciona.

> "Tira tudo que não seja imposto."

A IA reorganiza.

---

# 12. Personalização visual

Permitir personalizar:

- posição dos componentes;
- tamanho;
- ordem;
- densidade;
- tema;
- aparência;
- gráficos;
- informações exibidas;
- nome das páginas;
- agrupamento.

Exemplos:

> "Deixa mais minimalista."

> "Quero menos cards."

> "Quero algo parecido com um painel financeiro."

> "Mostra mais números e menos gráficos."

> "Quero uma visão para celular."

A IA deve alterar a interface sem destruir os dados existentes.

---

# 13. Memória e evolução

Manter contexto de longo prazo.

```text
Usuário
│
├── Perfil
├── Empresas
├── Pessoas
├── Patrimônio
├── Inventários
├── Documentos
├── Agentes
├── Dashboards
├── Preferências
├── Alertas
├── Regras
└── Histórico
```

A IA deve utilizar informações previamente autorizadas.

Exemplo:

> "Quanto aumentou meu imposto em relação ao ano passado?"

A IA utiliza os dados históricos.

---

# 14. Motor tributário

Criar uma camada independente da IA.

```text
INPUT
 ↓
Perfil
 ↓
Regime
 ↓
Atividade
 ↓
Faturamento
 ↓
Operações
 ↓
Despesas
 ↓
Documentos
 ↓
Regras tributárias
 ↓
Cálculos
 ↓
Oportunidades
 ↓
Resultado
```

Cada regra deve possuir:

```text
id
nome
categoria
jurisdição
condições
dados necessários
fórmula/regra
resultado
fonte
data de início
data de validade
nível de confiança
observações
necessidade de validação
```

O sistema deve ser preparado para regras versionadas.

---

# 15. Oportunidades tributárias

Procurar oportunidades legais de otimização, incluindo:

- regime tributário;
- classificação de atividade;
- classificação de produtos;
- créditos tributários;
- benefícios fiscais;
- incentivos;
- operações interestaduais;
- importação;
- exportação;
- folha;
- despesas;
- recuperação de valores;
- obrigações acessórias;
- tratamentos tributários específicos.

Nunca inventar economia.

Se não houver dados suficientes:

> "Não temos informações suficientes para estimar essa oportunidade."

Se não for aplicável:

> "Essa oportunidade não parece aplicável ao seu perfil."

Se não houver oportunidade:

> "Não encontramos uma economia relevante com os dados atuais."

Toda economia deve ser apresentada como **estimativa/economia potencial** e indicar quando necessita de validação profissional.

---

# 16. Dashboard tributário empresarial

Exemplo:

```text
Diagnóstico Tributário

Carga tributária
R$ 42.800/mês
12,4% do faturamento

R$ 513.600/ano

────────────────────────

Para onde está indo?

ICMS          R$ 12.400
PIS/COFINS    R$  7.200
IRPJ          R$  5.100
CSLL          R$  3.800
Outros        R$ 14.300

────────────────────────

Oportunidades

3 encontradas

Economia potencial:
R$ 87.400/ano

────────────────────────

Próximos eventos

4 obrigações
2 vencimentos
```

---

# 17. Comparação Hoje × Potencial

Componente central:

```text
                    HOJE          POTENCIAL

Tributos/mês       R$ 42.800       R$ 35.500

Tributos/ano       R$ 513.600      R$ 426.000

                                  ↓

                         R$ 87.600/ano
                         economia potencial
```

O sistema deve explicar:

> "Por que existe essa diferença?"

E apresentar as premissas.

---

# 18. Simulador

Criar ferramenta de simulação.

Permitir alterar:

- faturamento;
- despesas;
- folha;
- quantidade de funcionários;
- regime;
- operações;
- localização;
- outros parâmetros relevantes.

Exemplo:

> "O que acontece se meu faturamento subir para R$ 500 mil?"

Mostrar:

```text
Cenário atual
R$ 350.000/mês

Novo cenário
R$ 500.000/mês

Carga estimada
12,4% → 13,1%

Tributos
R$ 42.800 → R$ 65.500
```

---

# 19. Documentos

Permitir enviar:

- notas fiscais;
- documentos contábeis;
- declarações;
- comprovantes;
- documentos patrimoniais;
- documentos de inventário;
- outros arquivos relevantes.

A IA pode:

- identificar o documento;
- extrair informações;
- organizar;
- relacionar ao contexto correto;
- detectar informações faltantes;
- solicitar confirmação;
- utilizar dados extraídos em análises.

Exemplo:

> "Enviei 15 documentos. Organize tudo para mim."

---

# 20. Alertas e automações

O usuário deve conseguir criar alertas conversando.

Exemplos:

> "Me avise 10 dias antes dos impostos."

> "Me avise se a carga tributária passar de 15%."

> "Toda vez que aparecer uma nova oportunidade tributária, me avise."

> "Me avise quando faltar algum documento."

A plataforma deve transformar essas instruções em automações.

---

# 21. Relatórios

Permitir:

> "Gere um relatório da minha situação tributária."

O relatório deve conter:

- resumo;
- dados analisados;
- impostos;
- evolução;
- oportunidades;
- economia potencial;
- riscos;
- documentos;
- pendências;
- premissas;
- recomendações;
- informações que precisam de validação.

---

# 22. Compartilhamento

O usuário deve poder compartilhar partes específicas do sistema.

Exemplo:

> "Crie uma visão para minha contadora."

Permitir:

- somente leitura;
- comentar;
- editar;
- acesso a determinados dados;
- acesso apenas a determinado workspace.

---

# 23. Segurança

Priorizar:

- autenticação;
- controle de acesso;
- isolamento de dados;
- criptografia;
- logs;
- consentimento;
- privacidade;
- LGPD;
- controle de compartilhamento;
- permissões por agente;
- permissões por documento;
- permissões por workspace.

A IA nunca deve acessar informações que o usuário não autorizou para aquele contexto.

---

# 24. Arquitetura conceitual

```text
Frontend
   │
   ↓
AI Orchestrator
   │
   ├── Conversation
   ├── Memory
   ├── Tool Calling
   ├── UI Generation
   └── Agent Management
   │
   ↓
Application API
   │
   ├── Users
   ├── Companies
   ├── People
   ├── Assets
   ├── Inventories
   ├── Documents
   ├── Dashboards
   ├── Agents
   ├── Alerts
   └── Reports
   │
   ↓
Tax Engine
   │
   ├── Rules
   ├── Calculations
   ├── Simulations
   ├── Opportunities
   └── Sources
   │
   ↓
Database
```

---

# 25. Separação entre IA e motor de regras

A IA:

- conversa;
- interpreta;
- explica;
- decide qual ferramenta usar;
- organiza;
- cria dashboards;
- cria agentes;
- conduz o usuário.

O motor tributário:

- calcula;
- aplica regras;
- registra premissas;
- mantém versões;
- produz resultados determinísticos quando aplicável.

A IA não deve substituir o motor de cálculo.

---

# 26. Interface

A interface deve ser:

- premium;
- minimalista;
- dinâmica;
- personalizável;
- responsiva;
- mobile-first;
- moderna;
- fluida;
- acessível;
- não burocrática.

Evitar:

- aparência de ERP;
- excesso de tabelas;
- sidebar enorme;
- dezenas de menus;
- formulários intermináveis;
- excesso de cards;
- linguagem jurídica excessiva.

Preferir:

- canvas/workspace;
- chat integrado;
- componentes modulares;
- gráficos;
- números grandes;
- blocos contextuais;
- visualizações;
- transições suaves;
- interface adaptativa.

---

# 27. Layout adaptativo

A interface deve mudar conforme o contexto.

Se o usuário perguntar:

> "Quanto estou pagando?"

Priorizar números e gráficos.

Se perguntar:

> "Por que estou pagando isso?"

Mostrar explicações e detalhamento.

Se perguntar:

> "Quais documentos estão faltando?"

Transformar a área principal em checklist.

Se perguntar:

> "Compare dois cenários."

Transformar o dashboard em comparação.

A interface deve ser **contextual, não estática**.

---

# 28. Princípio Chat + Interface

Não criar:

```text
Chat
+
Dashboard separado
```

Criar:

```text
CONVERSA
    ↕
INTERFACE
    ↕
DADOS
```

A conversa modifica a interface.

A interface fornece contexto para a conversa.

---

# 29. MVP do protótipo

Implementar principalmente:

1. Login / workspace
2. Chat principal
3. Criação de contexto
4. Diagnóstico tributário
5. Dashboard gerado
6. Oportunidades
7. Simulador
8. Criação de uma IA especializada
9. Personalização do dashboard por conversa
10. Alertas simulados
11. Upload de documentos
12. Histórico/contexto

Não é necessário implementar inicialmente todo o motor tributário real.

Utilizar dados mockados, mas criar a arquitetura de forma que o motor real possa substituir os mocks posteriormente.

---

# 30. Jornada principal do protótipo

```text
Entrar
 ↓
"Quero organizar meus impostos."
 ↓
IA pergunta o contexto
 ↓
Usuário escolhe:
Empresa
 ↓
IA coleta dados
 ↓
Sistema executa diagnóstico
 ↓
Dashboard é criado
 ↓
Usuário vê:
quanto paga
onde paga
por que paga
 ↓
IA encontra oportunidades
 ↓
Usuário pergunta:
"Como posso pagar menos?"
 ↓
IA explica oportunidades
 ↓
Usuário:
"Crie um painel para acompanhar isso."
 ↓
Dashboard é atualizado
 ↓
Usuário:
"Me avise se houver mudança."
 ↓
Alerta criado
 ↓
Usuário:
"Crie uma IA para minha empresa."
 ↓
Novo agente criado
```

---

# 31. Evolução do produto

### Fase 1
Diagnóstico tributário empresarial.

### Fase 2
Pessoa física + Imposto de Renda.

### Fase 3
Prestadores de serviço.

### Fase 4
Patrimônio.

### Fase 5
Inventários.

### Fase 6
Documentos inteligentes.

### Fase 7
Agentes personalizados.

### Fase 8
Dashboards generativos.

### Fase 9
Alertas e automações.

### Fase 10
Ecossistema tributário completo.

---

# 32. Diferencial

O diferencial não deve ser apenas:

> "Calculamos seus impostos."

O diferencial é:

> **"Você conversa com seu sistema tributário."**

O usuário não precisa descobrir onde clicar, qual formulário preencher, qual dashboard abrir ou qual relatório gerar.

Ele simplesmente pergunta.

A plataforma transforma a intenção em ação.

---

# 33. Princípios fundamentais

### Clareza
O usuário deve entender o que está acontecendo.

### Transparência
Toda estimativa deve apresentar suas premissas.

### Segurança
Dados financeiros e patrimoniais devem ser protegidos.

### Não inventar
Sem dados suficientes, informar que não é possível concluir.

### Explicabilidade
O usuário deve poder perguntar:
> "Por que você chegou nessa conclusão?"

### Evolução
O sistema deve ficar melhor conforme o usuário o utiliza.

### Personalização
Cada usuário pode construir uma experiência diferente.

### Contexto
Cada IA deve conhecer apenas o contexto que possui autorização para acessar.

### Automação
O usuário deve poder transformar pedidos em regras e alertas.

---

# 34. Resultado esperado

O protótipo deve fazer o usuário sentir que possui um **assistente pessoal de inteligência tributária**, e não que está utilizando um software contábil.

A experiência final deve ser:

```text
ANTES

"Eu não sei quanto estou pagando."
"Não sei onde está indo."
"Não sei se estou pagando demais."
"Não sei quais documentos preciso."
"Não sei o que vence."
"Não sei o que perguntar ao contador."

                    ↓

                PLATAFORMA

                    ↓

DEPOIS

"Eu sei quanto pago."
"Entendo por que pago."
"Sei onde meu dinheiro está indo."
"Conheço as oportunidades."
"Sei o que precisa ser validado."
"Tenho meus documentos organizados."
"Tenho meus prazos acompanhados."
"Meu dashboard se adapta ao que preciso."
"Tenho IAs especializadas para cada contexto."
```

O produto deve transmitir:

**Clareza + Controle + Inteligência + Personalização + Evolução.**
