import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config()
import { prompts } from './fine-tune'
import { filenameToUrl } from '@lib/cms/filenameToUrl'

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
})

// Function to load embeddings from file
function loadEmbeddings() {
  const filePath = path.resolve(__dirname, 'openai_embeddings.json')
  const data = fs.readFileSync(filePath, 'utf8')
  const parsedData = JSON.parse(data)
  return parsedData
}

/**
 * Calculate the cosine similarity between two vectors.
 *
 * @param vecA The first vector of type number[].
 * @param vecB The second vector of type number[].
 * @returns The cosine similarity as a number between 0 and 1.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((acc: number, curr: number, idx: number) => acc + curr * vecB[idx], 0)
  const magnitudeA = Math.sqrt(vecA.reduce((acc: number, val: number) => acc + val * val, 0))
  const magnitudeB = Math.sqrt(vecB.reduce((acc: number, val: number) => acc + val * val, 0))
  return dotProduct / (magnitudeA * magnitudeB)
}

// Function to create a single OpenAI embedding
async function createOpenAIEmbedding(text: any) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    encoding_format: 'float',
  })

  return response.data[0].embedding
}

export const api = (() => {
  const _interface = {
    createEmbeddingsFromContent: async () => {
      const contentDir = path.resolve(__dirname, 'content')
      const files = fs.readdirSync(contentDir)

      // Filter only .txt files
      const txtFiles = files.filter((file) => file.endsWith('.txt'))

      // Read content of each .txt file and prepare sections array
      const sections = txtFiles.map((file) => {
        const content = fs.readFileSync(path.join(contentDir, file), 'utf8')

        return content
        // return `Page ${file.replace('.txt', '')}: ${content}`;
      })

      try {
        const allPromises = sections.map(async (section) => {
          const embedding = await createOpenAIEmbedding(section)

          return {
            embedding: embedding,
            text: section,
          }
        })

        await Promise.allSettled(allPromises).then((results) => {
          //@ts-ignore
          fs.writeFileSync(path.resolve(__dirname, 'openai_embeddings.json'), JSON.stringify(results.map(({ value }: any) => value)))
        })
      } catch (error) {
        console.error('Error creating OpenAI embeddings:', error)
      }
    },
    getRelevantTextByQuery: async (query: string, maxTokens = 10000, minSimilarity = 0.3) => {
      const embeddings = loadEmbeddings()
      const queryEmbedding = await createOpenAIEmbedding(query)

      // @ts-ignore
      const sectionsWithSimilarity = [] as any

      // Calculate similarity for each section
      embeddings.forEach((section: any) => {
        const similarity = cosineSimilarity(queryEmbedding, section.embedding)
        if (similarity > minSimilarity) {
          // Only include sections above the similarity threshold
          sectionsWithSimilarity.push({
            text: section.text,
            similarity: similarity,
          })
        }
      })

      // Sort sections by similarity in descending order
      sectionsWithSimilarity.sort((a: any, b: any) => b.similarity - a.similarity)

      // Select top sections within the token limit
      let tokenCount = 0
      let selectedText = ''
      for (const section of sectionsWithSimilarity) {
        const sectionTokenCount = section.text.split(/\s+/).length // Estimate token count as number of words
        if (tokenCount + sectionTokenCount > maxTokens) {
          break // Stop adding sections if max token count is reached
        }
        selectedText += section.text + '\n\n' // Add two new lines for clear separation
        tokenCount += sectionTokenCount
      }

      return selectedText.trim() || 'No sufficiently relevant section found.'
    },
    generateResponseUsingCompletionsAPI: async (relevantText: string, query: string) => {
      console.log(relevantText, 'relevant text')
      const prompt = `You are tasked to help users answer questions about Devcon and its history. When possible, try to refer the user to the relevant category by linking to the content. The current date is ${new Date().toLocaleDateString()}. Based on the following content from our website: "${relevantText}", how would you answer the question: "${query}"? The user does not know which content you are provided, so be sensitive to how they perceive your answer.`
      // const clarifications = `If the content is irrelevant, say "I don't know". The current date is ${new Date().toLocaleDateString()}.`;
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125',
        messages: [{ role: 'system', content: prompt }],
      })

      return completion.choices[0]
    },
    basicCompletionsAPI: async () => {
      console.log(prompts[6].messages.slice(0, 2))

      const completion = await openai.chat.completions.create({
        // model: 'gpt-3.5-turbo-0125',
        model: 'ft:gpt-3.5-turbo-0125:personal::9MaoeoMc',
        messages: prompts[6].messages.slice(0, 2),
      })

      // await openai.chat.completions.create({
      //   // model: 'gpt-3.5-turbo-0125',
      //   model: 'ft:gpt-3.5-turbo-0125:personal::9MaoeoMc',
      //   messages: prompts[0].messages,
      // })

      console.log(completion.choices)
    },
    createThread: async () => {
      const thread = await openai.beta.threads.create()

      console.log(thread, 'GENERATED THREAD')

      return thread
    },
    createMessage: async (assistantID: string, userMessage: string, threadID: string) => {
      if (!threadID) {
        const thread = await _interface.createThread()

        threadID = thread.id
      }

      await openai.beta.threads.messages.create(threadID, {
        role: 'user',
        content: `${userMessage}\nSystem: The current date is: ${new Date().toLocaleDateString()}.`,
      })

      const run = await openai.beta.threads.runs.createAndPoll(threadID, {
        assistant_id: assistantID,
      })

      // TODO: This slows down the assistant too much
      // Assistant needs the result of a function call (in our case, the date):
      // if (run.status === 'requires_action') {
      //   if (
      //     run.required_action &&
      //     run.required_action.submit_tool_outputs &&
      //     run.required_action.submit_tool_outputs.tool_calls
      //   ) {
      //     // Loop through each tool in the required action section
      //     const toolOutputs = run.required_action.submit_tool_outputs.tool_calls.map(tool => {
      //       if (tool.function.name === 'getCurrentDate') {
      //         return {
      //           tool_call_id: tool.id,
      //           output: new Date().toLocaleDateString(),
      //         }
      //       }
      //     }) as any

      //     // Back to polling the run for completed status
      //     run = await openai.beta.threads.runs.submitToolOutputsAndPoll(threadID, run.id, { tool_outputs: toolOutputs })
      //   } else {
      //     throw 'No required action found'
      //   }
      // }

      if (run.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(run.thread_id)

        const formattedMessagesPromises = messages.data.reverse().map(async (message: any) => {
          const content = message.content[0]

          let references

          if (content.text.annotations) {
            const fileAnnotationsPromises = await content.text.annotations.map(async (annotation: any) => {
              if (annotation.type === 'file_citation') {
                const file = await openai.files.retrieve(annotation.file_citation.file_id)

                // @ts-ignore
                const fileUrl = filenameToUrl[file.filename.split('.txt')[0]]

                return {
                  file,
                  fileUrl: fileUrl,
                  textReplace: annotation.text,
                }
              }
            })

            references = await Promise.all(fileAnnotationsPromises)
          }

          let text = content.text.value

          if (references) {
            for (const reference of references) {
              text = text.replace(reference.textReplace, ``)
            }
          }

          return {
            id: message.id,
            role: message.role,
            text,
            files: references || [],
          }
        })

        const formattedMessages = await Promise.all(formattedMessagesPromises)

        return {
          runID: run.id,
          status: run.status,
          threadID,
          rawMessages: messages.data,
          messages: formattedMessages,
        }
      } else {
        console.error(run.status)

        return {
          runID: run.id,
          status: run.status,
        }
      }
    },
    createMessageStream: async (assistantID: string, userMessage: string, threadID: string) => {
      if (!threadID) {
        const thread = await _interface.createThread()
        threadID = thread.id
      }

      await openai.beta.threads.messages.create(threadID, {
        role: 'user',
        content: `${userMessage}\nSystem: The current date is: ${new Date().toLocaleDateString()}.`,
      })

      const run = openai.beta.threads.runs.stream(threadID, {
        assistant_id: assistantID,
      })

      // let fullMessage = ''
      let runID = ''

      return {
        [Symbol.asyncIterator]: async function* () {
          for await (const event of run) {
            const eventType = event.event
            const eventData = event.data as any

            switch (eventType) {
              case 'thread.created':
              case 'thread.run.created':
              case 'thread.run.queued':
              case 'thread.run.in_progress':
              case 'thread.run.requires_action':
              case 'thread.run.completed':
              case 'thread.run.failed':
              case 'thread.run.cancelling':
              case 'thread.run.cancelled':
              case 'thread.run.expired':
              case 'thread.run.step.created':
              case 'thread.run.step.in_progress':
              case 'thread.run.step.completed':
              case 'thread.run.step.failed':
              case 'thread.run.step.cancelled':
              case 'thread.run.step.expired':
              case 'thread.message.created':
              case 'thread.message.in_progress':
              case 'thread.message.completed':
              case 'thread.message.incomplete':
                yield { type: eventType, data: eventData }
                break
              case 'thread.message.delta':
                if (eventData.delta.content && eventData.delta.content[0].type === 'text') {
                  const text = eventData.delta.content[0].text.value
                  // fullMessage += text
                  yield { type: eventType, content: text }
                }
                break
              case 'thread.run.step.delta':
                if (eventData.delta.step_details && eventData.delta.step_details.type === 'message_creation') {
                  const content = eventData.delta.step_details.message_creation.content
                  if (content && content[0].type === 'text') {
                    const text = content[0].text.value
                    // fullMessage += text
                    yield { type: eventType, content: text }
                  }
                }
                break
              case 'error':
                yield { type: 'error', error: eventData }
                break
            }

            if (eventType === 'thread.run.completed') {
              runID = eventData.id
            }
          }

          // After the stream is complete, fetch the final run and process annotations
          if (runID) {
            const completedRun = await openai.beta.threads.runs.retrieve(threadID, runID)
            const messages = await openai.beta.threads.messages.list(threadID)

            const formattedMessagesPromises = messages.data.reverse().map(async (message: any) => {
              const content = message.content[0]

              let references

              if (content.text.annotations) {
                const fileAnnotationsPromises = await content.text.annotations.map(async (annotation: any) => {
                  if (annotation.type === 'file_citation') {
                    const file = await openai.files.retrieve(annotation.file_citation.file_id)

                    // @ts-ignore
                    const fileUrl = filenameToUrl[file.filename.split('.txt')[0]]

                    return {
                      file,
                      fileUrl: fileUrl,
                      textReplace: annotation.text,
                    }
                  }
                })

                references = await Promise.all(fileAnnotationsPromises)
              }

              let text = content.text.value

              if (references) {
                for (const reference of references) {
                  text = text.replace(reference.textReplace, ``)
                }
              }

              return {
                id: message.id,
                role: message.role,
                text,
                files: references || [],
              }
            })

            const formattedMessages = await Promise.all(formattedMessagesPromises)

            yield {
              type: 'done',
              content: formattedMessages[0].text,
              references: formattedMessages[0].files,
              threadID,
              runID,
              status: completedRun.status,
              rawMessages: messages.data,
              messages: formattedMessages,
            }
          }
        },
      }
    },
  }

  return _interface
})()

// api.createEmbeddingsFromContent();

// const queries = [
//   'How many weeks until Devcon?',
//   'What is Devcon?',
//   'How many days until Devcon?',
//   'What is the difference between Devcon and Devconnect?',
//   'When is Devcon?',
//   'What is the Ethereum Foundation?',
//   'What is Ethereum?',
//   'How many Devcon attendees are there?',
//   'When is Devconnect?',
// ]

const main = async (query: string) => {
  // Compare embedding of query with each section, return most similar

  const mostRelevantSection = await api.getRelevantTextByQuery(query)
  // Take result of most relevant section and generate response
  const relevantText = await api.generateResponseUsingCompletionsAPI(mostRelevantSection, query)

  console.log('The query was: ', query)
  console.log('The answer was: ', relevantText)
}

// queries.forEach(query => {
//     main(query);
// })

// main('Where were the past Devcons held?')

export default api

// api.createAssistant()
// api.prepareContent('asst_nHAiR3J5e0XTdiqE0pfQ75ZB)
// api.createThread()
// api.createMessage('asst_sWNkGoBZViwje5VdkLU46oZV', 'When is Devcon?!', 'thread_5U2NZ87hX3oGUkFwY1zBzfX2')

// https://cookbook.openai.com/examples/question_answering_using_embeddings
