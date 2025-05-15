import { motion } from 'framer-motion';
import { SparklesIcon } from './icons';
import { useCallback } from 'react';

export const Greeting = () => {
  const handleQuestionClick = useCallback((questionText: string) => {
    try {
      const event = new CustomEvent('galaxy:question-selected', { 
        detail: { question: questionText },
        bubbles: true 
      });
      window.dispatchEvent(event);
      
      setTimeout(() => {
        const inputField = document.querySelector('[data-testid="multimodal-input"]') as HTMLTextAreaElement;
        if (inputField) {
          inputField.value = questionText;
          
        const inputEvent = new Event('input', { bubbles: true });
        inputField.dispatchEvent(inputEvent);
        
        inputField.focus();
        
        setTimeout(() => {
          try {
            const keyEvent = new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13
            });
            inputField.dispatchEvent(keyEvent);
          } catch (err) {
            console.error('Enter 키 이벤트 발생 실패:', err);
          }
        }, 100);
      }
    }, 100);
    } catch (error) {
      console.error('샘플 질문 선택 처리 중 오류:', error);
    }
  }, []);

  return (
    <div
      key="overview"
      className="max-w-3xl mx-auto md:mt-16 px-8 size-full flex flex-col justify-center items-center"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 100 }}
        className="bg-gradient-to-r from-galaxy-blue to-galaxy-purple text-white p-3 rounded-full mb-6 shadow-galaxy-hover"
      >
        <SparklesIcon size={30} />
      </motion.div>
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ delay: 0.5, type: "spring" }}
        className="text-3xl font-bold bg-gradient-to-r from-galaxy-blue to-galaxy-purple bg-clip-text text-transparent mb-2"
      >
        Galaxy S25 Assistant
      </motion.div>
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ delay: 0.6, type: "spring" }}
        className="text-lg text-zinc-500 text-center max-w-md whitespace-nowrap"
      >
        안녕하세요! Galaxy S25에 대해 어떤 도움이 필요하신가요?
      </motion.div>
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ delay: 0.7 }}
        className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-lg"
      >
        {[
          { title: "카메라 기능", description: "Galaxy S25의 최신 카메라 기능 알아보기" },
          { title: "배터리 성능", description: "배터리 최적화 및 절약 팁" },
          { title: "AI 기능", description: "Galaxy AI 기능과 사용법" },
          { title: "커스터마이징", description: "화면 및 시스템 설정 커스터마이징" }
        ].map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 + i * 0.1 }}
            className="p-4 bg-white border border-galaxy-light rounded-xl shadow-galaxy hover:shadow-galaxy-hover transition-all duration-200 cursor-pointer transform hover:scale-[1.02] hover:bg-galaxy-light/20"
            onClick={() => handleQuestionClick(item.title)}
          >
            <h3 className="font-medium text-galaxy-blue">{item.title}</h3>
            <p className="text-sm text-zinc-500">{item.description}</p>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
};
