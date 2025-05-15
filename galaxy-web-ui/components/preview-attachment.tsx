import type { Attachment } from 'ai';
import { LoaderIcon } from './icons';
import { useEffect, useState } from 'react';

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
}: {
  attachment: Attachment;
  isUploading?: boolean;
}) => {
  const { name, url, contentType } = attachment;
  const [imageSrc, setImageSrc] = useState(url);
  const [isError, setIsError] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);

  // 디버깅용 로깅
  useEffect(() => {
    console.log('첨부파일 렌더링 시도:', { 
      타입: contentType, 
      URL: url,
      이름: name
    });
  }, [contentType, url, name]);

  const handleImageError = () => {
    console.error('이미지 로드 실패:', url);
    setIsError(true);
  };

  const handleImageLoad = () => {
    console.log('이미지 로드 성공:', url);
    setIsImageLoaded(true);
  };

  // URL이 비어 있거나 유효하지 않은 경우 렌더링하지 않음
  if (!url || url === 'undefined' || url === 'null' || url.trim() === '') {
    console.log('첨부파일 건너뜀: 유효하지 않은 URL', url);
    return null;
  }
  
  // 컨텐츠 타입이 없거나 유효하지 않은 경우 체크
  if (!contentType) {
    console.log('첨부파일 건너뜀: 컨텐츠 타입 없음', url);
    return null;
  }

  return (
    <div data-testid="input-attachment-preview" className="flex flex-col gap-2 w-full">
      {contentType?.startsWith('image') ? (
        <div className="w-full flex justify-center items-center">
          {isError ? (
            <div className="bg-gray-100 p-4 rounded-md text-sm text-gray-600 w-full">
              이미지를 불러올 수 없습니다
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={imageSrc}
              alt={name ?? '이미지 첨부파일'}
              className="rounded-lg max-w-full"
              style={{ maxHeight: '400px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
              onError={handleImageError}
              onLoad={handleImageLoad}
            />
          )}
        </div>
      ) : (
        <div className="bg-gray-100 p-2 rounded-md text-sm text-gray-600">
          {name || '첨부파일'}
        </div>
      )}

      {isUploading && (
        <div
          data-testid="input-attachment-loader"
          className="animate-spin absolute text-zinc-500"
        >
          <LoaderIcon />
        </div>
      )}
    </div>
  );
};
